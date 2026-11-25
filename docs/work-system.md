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
- **A task's Intent is set at create** and changes only by an amend
  with its why: `task edit --intent` rewrites it before work starts,
  and after that `note T-n --intent` (or `task update --intent --note`)
  amends it, the old text kept in its history. A re-plan delta goes to
  the journal; a new direction is new tasks and edges on the track, or
  a side track.
- **Three statuses, one word.** A task's stored status is `open`,
  `done` or `dropped`. A session closes it as `done` when the work has
  landed where the Intent says it lands (a merge, a release, a
  delivery), and as `dropped` when it is abandoned. Everything else is
  the task's word, computed by the board from its runs, edges, gates and
  wakes, never set; there is no "in progress" to flip:

  | Word | When | The row says |
  |-|-|-|
  | done, dropped | the task has ended | |
  | running | a run is open and was heard from in the last three minutes | who, for how long |
  | unconfirmed | a run is open and was not heard from in three minutes | who, on which PC, not heard since when |
  | waiting | an edge, a gate or a wake is open | on what |
  | ready | none of the above | to start; to continue (the last run handed on, failed or was taken over); to settle (the last run finished) |

  A run is one worker's go at a task. An agent's run opens when the mod
  sees the engine answer a dispatch that names the task, and ends when
  the agent ends, with its report. The session's own run opens when it
  takes the task in hand (`--in-hand --session <own-id>`, the
  `task_update` tool's `inHand`), and a close, a let go or a handoff
  ends it. What a task waits on is a "depends on" edge, a question's
  gate or a wake, never a status.
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
| `task create` | payload on stdin; issues `T-n`; a session's names its place (`--tier 2 --before` at a real place on the track it holds, filed at once; `--last`, `3` with `--track` or `--unpark-when`, `4` with `--workstream` and `--track` or `--wake`, or `--wake next-session`, with the reason and `--here-before`, asked of the user first), and the board places it or asks (Creating, below); every filing on no track names its `--wake` |
| `task update <id>` | `--status open\|done\|dropped`, `--in-hand`/`--let-go` (with `--session`), `--take-over`, `--reason` (starting a task that is not ready), `--note` (a journal paragraph in the same call), `--priority`, `--name`, `--add-label`/`--remove-label`, `--check-add`/`--check-done`/`--check-strike`; with `--status done` or `dropped`, `--leftovers` reads the steps the close leaves on stdin, each filed as a task with it; `--move-steps` reads the moves of open steps someone else does on stdin; the mod's `task_update` tool |
| `task edit <id>` | the field flips: `--status`, `--priority`, `--name`, `--workstream`, `--clear-workstream`, `--serves`, `--clear-serves`, the label and ref flags, `--in-hand`, `--let-go`, `--take-over`, `--close "with T-n"` and `--clear-close`; `--tier` with its answer, as on `task create`, moves it (onto the held track at a real place at once; off it, or to a later session, asked first), and `--wake` alone wakes an inbox task again; `--leftovers` as on `task update`. A task has no plan or ordinal on the board (`--plan` and `--ordinal` are refused) |
| `note <id>` | `--body "text"`, or the body on stdin; appends one stamped journal paragraph to a workstream, task, track or knowledge record |
| `track new`, `list`, `show`, `mine`, `park`, `finish`, `drop`, `splinter`, `capture`, `layout`, `reorder`, `found` | tracks (Tracks and handoffs, below) |
| `resume <TR-n>` | take a track with its kickoff |
| `coverage <TR-n>`, `review covers`, `commit move` | review coverage (Tracks and handoffs, below) |
| `handoff write <TR-n>` | payload on stdin; issues `TR-n.m` |
| `shelf` | waiting and parked tracks everywhere, oldest first |
| `sweep` | `--track TR-n`, `--since YYYY-MM-DD` or `--since-last`: what earlier sessions left behind, gathered for one reader agent (Tracks and handoffs, below) |
| `edge add`, `edge remove` | "depends on" edges, each with `--reason` |
| `check add`, `check done`, `check strike`, `check move` | a task's checklist |
| `knowledge new`, `knowledge supersede` | gotchas and decisions (Knowledge, below) |
| `projects`, `projects scan [<folder>...]` | this PC's project map: each project's shared name and its folder here, marking an entry whose folder is gone or is now another project; a scan maps the checkouts it finds, never a desktop-app scratch workspace |
| `projects forget <name>` | drops one entry from this PC's map; nothing is dropped on its own, since a folder on an unplugged drive comes back |
| `projects rename <old name> <new name>` | on the board, in one transaction: every question, workstream, knowledge record, procedure card and profile holding of the old shared name moves to the new one; `--folder <old dir>=<new dir>` (repeatable) moves the folders they name; `--dry-run` prints the counts; a new name that holds records is refused; this PC's map then drops the old name |
| `profile ...` | depth settings and rules in force (Profiles, below) |
| `list --kind workstream\|task\|knowledge` | the open set of one kind; `--workstream` (for knowledge, its project's, the global ones and the decisions naming it), `--project <dir>` (knowledge only), `--status`, `--priority`, `--label`, `--open`, `--all`; `--json` gives a knowledge row its text as `body` |
| `show <id>` | one record at a read level (Listing and showing, below) |
| `resolve`, `activity`, `search` | as in question-hub.md |

The writes take `--session <own-id>`, and a create payload carries a
`session` key instead: pass your own session id so your own work stays
quiet in other sessions' inboxes (Events, below), and so the activity
row says which session made the change rather than `cli`.

Working a task, end to end:

```bash
node ~/.claude/askerdo/cli.mjs task update T-13 --in-hand --session <own-id>
node ~/.claude/askerdo/cli.mjs note T-13 --session <own-id> < note.txt
node ~/.claude/askerdo/cli.mjs task update T-13 --status done --session <own-id>
```

An agent's run needs no call: a dispatch that names the task opens it.

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
  inbox, with its wake, until it is captured onto a track. The inbox holds
  only work no plan reaches: work that starts later goes on a parked track
  that opens on its own event. It may carry a checklist and name the
  outcomes it `serves`.
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
| `task create` | `name`, `description`; from a session, its place (`tier` with `before` on the held track, or the place asked for with its reason and `here`: below); on no track, `wake` (what brings it back), unless it is filed done or dropped | `intent`, `workstream`, `track` (a TR-n id: the task lands on that track), `before` and `after` (T-n ids on that track: the steps that wait on it, the ones it waits on), `newTrack` and `unparkWhen` (a parked track the event opens), `unplaced` (why no plan reaches it, or why that date), `priority`, `status`, `serves` (outcome ids), `labels`, `refs`, `origin`, `session`, `created` |
| `track new` | `--workstream`, `--name` | `--goal`, `--task T-n`, `--label`, `--ref` (each repeatable; labels and refs come at birth only), `--session` (the session takes it) |

`session` is your own session id, read from the scratchpad path the
harness announces. `created` carries a converted record's real age, in
either stamp form, and is stored exactly as given; `origin` records
where a converted record came from. A referenced workstream MUST already
exist: a dangling reference is refused (exit 1), never created on the
fly. A task created without `serves` in a workstream with outcomes is
flagged with a warning, never refused. `create --json` returns `{id,
key, kind, name}`. Use the returned id from then on.

**Found work gets its home the turn it is found.** First an open task
that already covers it takes it as a `note` (with the new title,
description and intent when it changes that task); else the session
looks outward from the work in hand:

| Where it goes | The call |
|-|-|
| a plain defect in the work in hand with one right fix that fits this turn | none: fix it, file nothing |
| a step on the task whose worker will do it, in hand or not | a checklist step (`task_update` `checks`, `check add`); on another open task, `moveSteps` `onto` it |
| a real place on the track the session holds | `place` (`task create`) on that track with `after` what it needs and `before` the open tasks that must not finish without it: filed at once |
| last on that track, or anywhere off it: another track, a new or parked track, another workstream or project, an inbox, a later session | the same call with the place asked for, its reason and `here`, the real place on the held track: asked of the user, nothing created until their press |
| anything only the user can decide or do, or nothing needs it | `ask`, with `gates` when a task exists |

A step is done by whoever runs its task. A step on a task that its
worker will not do moves in the call that finds it, with `task update
T-n --move-steps` (the `task_update` tool's `moveSteps`), one of three
ways: onto the open task its worker will run (the track's review, its
look: `{ "check": 3, "onto": "T-20" }`, struck "moved to T-20 step 4"),
into a new task when none is open (`{ "check": 3, "runBy", ... }` with a
filing's place fields, struck "moved to T-31"), or into a question when
it is the user's (`{ "check": 3, "question": "Q60" }`, struck "asked as
Q60"). A move onto a task on the same track, or to a question, is free;
a move onto a task on another track, or into a new task off the held
track, is asked like any filing off it. A step moved to a question does
not gate its task by itself: when the task needs the answer, the
question gates it (`gates` at registration, or `question edit Q60
--add-gate T-13`).

**A real place is free; anything else is asked.** A filing from a
session that holds a track lands at once when at least one open task on
that track, other than its closing review, waits on the new work:
directly (`before`, `--before`) or through a later step of the same
call that itself has a real place. The closing review is an open review
no open task on the track waits on; one a look or a fix waits on is
mid-track, so `before` naming it is a real place. Every id in
`before` must be an open task on the held track and every id in
`after` must exist; a wrong id is refused, naming it. A step whose `after` reaches open work on the held
track that nothing there follows but the closing review is the track's
end: there is no order to be last in, so it lands at once with no
`before` (a `last` sent with it is still asked). When the held track has
no open task but the one being closed and the closing review, the work
lands on the track and is the next thing taken.

Every other place is asked: last on the held track (`last`, `--last`,
which puts a task before the track's closing review, so it waits until
the track runs out of other work), another track (`tier` 3 with
`track`), a parked track an event opens (`unparkWhen`, with `newTrack`
to name it), another workstream or project (`tier` 4 with `workstream`
and a track there, or `wake` for its inbox), a date wake (`wake` with
why that date in `unplaced`), a later session (`wake: next-session`,
`--wake next-session`, at any tier, and the bare `task edit T-n --wake
next-session` of a task on the held track), an existing task moved off
the held track, and a step moved onto a task on another track. Such a
filing carries both places and the reason, or it is refused naming what
is missing: the place asked for, its reason (`last`'s line, or
`whyElsewhere`, `--why-elsewhere`, one line on why the held track's real
place does not fit; one parked on, or woken by, the held track's own
end, task or question adds, after a semicolon, why it cannot start
sooner), and `here` (`--here-before`, `--here-after`), the real place on
the held track the work would otherwise take, checked as a real place,
left out when nothing on the held track waits on the work.

Nothing is created while the user decides. The board registers a
question labelled `placement` in the filing's own transaction, on the
filing session and its held track, not blocking: its gist says what was
found, why the session asks to move it, where it would sit on the held
track and where the session asks to put it, by task name. Its options
are fixed: a, do it on this track (created at `here`); b, put it where
asked (the session's pick, created at the place asked for, making the
parked track when that is the place); c, let's talk where it fits; d,
drop it. A filing with no `here` has no do-it-on-this-track row: its
options are a, put it where asked (the pick); b, let's talk; c, drop it,
so no press adds a dependency nobody meant. The press creates the task with no model turn, as the filing
session, and the new task's journal names the question and the press;
the answer's inbox event tells the session the task's id and place, or
the outcome. After a talk (c, or a note with no press) the session lays
out the candidate places and files the settled one with `question`
(`--question Q-n`) and the user's settling words (`words`, `--words`):
the board lets one filing through for that question at the place sent.
A drop, the card's quiet drop, or a snooze creates nothing. If a task
named in the pressed place has closed it is left out; with no open task
left to wait on the work, or the track closed, the answer stands,
nothing is created, and the outcome is `stale`, which the session treats
as talk. Once a task was created an amend is refused, naming the task.
A track is not finished or dropped while a placement question of its
work is open: `track finish` and `track drop` refuse, naming each.

A filing's result is the task, `{ asked }` with the question, or a
refusal naming the call that fits. A close's or a handoff's leftovers,
`moveSteps` into new tasks and `track layout` on a held track that
already has tasks are placed step by step: steps at a real place are
filed, each asked step becomes its own question, and the close or the
handoff lands in the same call; a refused step (a wrong id, no place
named) refuses the whole call. A layout onto a held track with no tasks
yet is laid out whole. `track capture` and `task create` with a named
track follow the same rule. A session's `track new` or `splinter` with
`--task` that would carry tasks off its held track is refused, naming
the place call that asks for each, and so is a session's `track finish
--leftovers inbox`: each open task is finished, dropped or placed.

Not found work, and never asked: the user's own `/askerdo` command (the
mod sends `--user <sid>` in place of `--session`), the board picture
applied whole, edges and order inside the held track, a step moved onto
a task on the same track or to a question, and waking an inbox task
again where it already sits. A session holding no track files as
before: `tier` 2 with no track held is refused offering the hint's
track at tier 3, or `ask`. A creation with no session (a person's own
call, the import, the board's own verbs) names no tier and the board
records the one its landing implies, though a filing into the inbox
still names its wake (below). The session is the payload's `session`,
else `--session`, else the shell's `CLAUDE_CODE_SESSION_ID`, so a filing
from a session's shell counts as the session's. `--user` is the mark of
the user's own press or command, which the plugin sends; a session never
sends it. Where the mod runs, it refuses a session's or an agent's shell
call of the live board that files or moves work with `--user`, with a
`--session` other than its own, or with `CLAUDE_CODE_SESSION_ID` cleared
or set, an override press (`override decide`, `override unscrub`) with
`--user`, and a shell answer or drop of a placement question (named
`Q12`, `q12` or `12`); the answer tool records a placement answer only
when a message of the user's since the question was asked names it (`Q12`
or a token such as `12b`; a bare number names nothing), and sends it with
the user's mark, its result saying what the answer created; and an
`/askerdo` line the user did not start (the model's Skill call, another
session's message, a started session's prompt; the Remote Control bridge
is the user's own) never runs a command that carries the mark. A call
inside a script file the session writes is not seen. A filing onto another
track leaves a note on that track, which reaches its holder. The hint is
the open track sharing the most labels, files and words with the task
(its name, goal, last handoff's focus and task names), the session's own
track first among ties: an offer the session takes or leaves, never
applied for it. The task keeps its `tier` and its reason line, and its
block (`show T-n`), `track found` and the handoff's found list print
them. A task that waits on the next session reads ready in the first
kickoff of a session other than the one that filed it; the inbox refuses
it. An agent files nothing: found work goes in its report, and its
session places each item the turn the report arrives.

**The inbox holds only work no plan reaches.** Work that starts later
goes on a parked track that opens on its own event, once the user approves that place: a tier 3 filing
with `--unpark-when "task-completes T-n"` (and `--new-track "<name>"`)
makes that track and parks it, or `track new` and `track park TR-n
--unpark-when ...` then the place command. An
unplaced reason that says no track carries the work ("no track carries
it yet", "needs its own track") is refused with those commands.
Every inbox filing names its wake, whoever files it (a session, a
terminal, code): `--wake` on `task create`, `task edit`, `track capture`,
and `track finish` or `drop` with `--leftovers inbox`, in the vocabulary
`track park --unpark-when` uses (`"track-ends TR-n"`, `"task-completes
T-n"`, `"question-answered Q-n"`) or a date (`2026-12-01`). A filing
with none is refused with the inbox's rule and both ways out as
commands: put it on a track, or file it again with its wake. A wake that
has already fired, a date today or earlier or an event already ended, is
refused the same way. A task filed done or dropped needs none. Code
that files passes its own, 14 days out: the user's `/askerdo track
capture inbox`, an import's tasks and closes, the doctor's undo and the
board picture's moves. A task with no wake stored reads as due 14 days
after it entered the inbox (its last move off a track, else its birth).
A task is due once its event ends or its date comes: it leads every
kickoff on its project in a "Due for a home" line naming its workstream,
with the place command on its own workstream's tracks (another's kickoff
only names it), ahead of the inbox list, until it is placed or
woken again (`task edit T-n --wake ...`, which takes a task on no track
alone). The third wake in one inbox stay (counted from its last move off
a track, else its birth) stores nothing: the user gets a question, not
blocking, with three answers: place it, keep it with a reason and a new
wake, or drop it. While it is open the task's inbox row names it and a
further wake waits on it. A keep starts the count over; a place or a
drop refuses further wakes. Placing the task on a track, or ending it,
drops the open question. Placing a task on a track clears its wake.
The inbox never takes work waiting on the end of the track the filing
session holds: that work is a step on the track. `task create`, `task
edit`, `track capture` and a close's leftovers refuse a wake of
`"track-ends TR-n"` naming the session's own track, and the refusal says
to file it on that track with `--after` or `--before` the step it
follows. A filing with no session, or waiting on another track's end, is
unchanged; a track finish or drop sending its open tasks to the inbox to
wait on its own end is refused as a wake that fires with the close.

**Closing a task carries its leftovers.** Whatever doing a task turned
up goes on the board with the close, never in its closing note, where
nothing brings it back. `task update T-n --status done` (or
`dropped`, and `task edit` the same) with `--leftovers` reads a JSON
list of steps on stdin, the handoff's leftover shape (below): each
`{ "name", "runBy" }` with `after`, `before`, `description`, `priority`
or `task` as a handoff's step takes them (`{ "check": 3, "runBy" }`
files the task's open step 3 instead), and each names its place as a
filing does (`tier`, `track`, `workstream`, `newTrack` and
`unparkWhen`, `unplaced`, `wake`, `last`, `whyElsewhere` and `here`).
Each step follows the found work rule: a step at a real place on the
held track (after the closing task when it names no `after`) is filed
with the close, and each step asked last, off the track or for a later
session becomes its own placement question, created only on the user's
press; an inbox step the user approves goes through every inbox
filing's refusals. The close and its leftovers land in one transaction:
a refused step (a wrong id, no place named) names itself, and the task
stays open with nothing filed. The result names each filed task and
where it went, and each question asked
("T-12 updated: status; filed T-30 (on TR-4); asked Q61 for T-31's place"). The mod's
`task_update` tool takes the same list as `leftovers`. Where the mod runs,
a close whose note or reason names something left ("not measured", "left
open", "known limit") with no leftovers filed, a note naming one on a task
already done or dropped, and a track finish or drop whose outcome or
reason names one each get a line to the session (on the tool's result, or
as a note after a hub CLI call from the shell) pointing at the nearest home
that comes back on its own: a task at a real place on the held track, or
a question that asks the user for another place; the call goes through as made, and a record is
flagged once a session.

`track found TR-n` lists the tasks the track's arc made: the ones on it
since it began (`--since handoff`: since its last handoff) and the ones
its sessions filed anywhere, each with where it went (this track before
or after which step, another track, or unplaced with its reason) and the
command that moves it. The handoff result and the kickoff say where each
went and list the unplaced with their reasons; a question gating a
release task (its name starts with Release, or it carries the label
`release`) gets a line in its gist, "Found this arc: N tasks: M on TR-n
before it, K on other tracks, U unplaced", naming the unplaced, so the
card the user answers from shows it; the Tracks tab draws a "Found this
arc" row per track that found any, the unplaced count first.

### One question for a planned set of moves

A planned set of moves across tracks is asked once, as one go question.
The session takes the task the moves belong to in hand and registers one
`ask` with its yes option marked `go` (`options[n].go: true`, on at most
one option) and that task in `gates`, the moves listed in its gist. The
board adds a line to the gist saying what answering it allows. Only the
user answers it. While the answer stands on that option and the session
has an open run on the open task, the session's filings and moves land
at the place they name with no question. An
amend to another letter or the task's close ends it. The
doctor, the sweep, onboarding and a board review all take this road when
they move work across tracks: the session asks, and an agent writes no
tasks, drafting a list of moves that the session applies.

The user has two more roads, which no session can turn on:

- **The tray's Task placement bypass** covers every session or one named
  session, for a time from the Bypass times setting; one session until it
  ends (an idle end keeps it for up to 8 hours, so a reopen goes on with
  it; any other end clears it); or every session until it is turned off.
  A timed switch counts down on the band. Any tray switch outranks the
  setting below and writes none of its layers.
- **The Task placement setting** (`placement.mode`, Sessions): `ask`, the
  built-in, or `model`, at the Settings layers, the more specific layer
  winning. It changes by the user's press in the Settings tab or on the
  board's settings page, and `settings set` refuses it.

While a tray switch or the setting covers a session, its rules block
says so. Under every road a move lands at the place named, another
session's running task included; a placement question stays the user's
to answer and still holds its track's finish, and an agent's filing is
refused as always.

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
- `--in-hand` (with `--session`) takes a task in hand: in hand is an
  open run by the session. A session may hold several, tasks of another
  track included, the newest shown on the status line. A task
  whose open run belongs to another session is refused naming the
  holder (session, PC, since) and moves only with `--take-over`, on the
  user's word, which that session hears at its next prompt. `--let-go`
  ends the run; an ended task is never in hand. A handoff ends every run
  the session has open as handed on, so its tasks read ready to
  continue; a resume gives nothing back in hand, and the session takes
  what it judges from the kickoff. When a session's process ends, for
  whatever cause, its runs stay open and go unheard, so their tasks read
  unconfirmed; a reopened session's first beat renews the same runs and
  its tasks read running again, and another session takes one over only
  on the user's word.

An edit flips the fields it names plus `updated`, and nothing else. An
edit whose named fields already hold those values writes nothing at all.
A task moves through its statuses this way and only this way: there is
no task close verb, and a task reopens by setting its status back to
`open`.

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
fresh label. A task ends by `task update --status done` or `dropped`;
a track by `track finish` or `track drop` (an old track may read
`folded`, an ending no verb makes).

EVERY CLOSE GOES THROUGH ONE GATE. `task update`, `task edit`, a close
`with T-n` and the board picture's verdicts all refuse while a step is
open, naming each step and the calls that settle it: done
(`--check-done 2`, `checks.done`), struck with a word why
(`--check-strike "2: why"`, `checks.strike`), filed as its own task (a
leftover `{ "check": 2, "runBy" }`), or first moved in its own call
(`--move-steps`). A refused close writes nothing. A close also ends the
runs open on the task; one over another session's run is refused naming
it and goes only with `--take-over`, on the user's word.

A look at finished work is a task labelled `look` that the session
runs: its steps are the things to show, the session runs each itself on
the user's surface, and its last act is one question listing what needs
the user's eye, gating that task (one question per look, never one per
item). Registering that question ends the asking session's run on it as
handed on. The user's "right" opens the gate and the session closes the
task; "not yet" with their words makes it ready again. A checkable fact
is the done clause of the task's description, and its session closes it
once the fact holds.

THE STOP CHECK, where the mod runs: code insists on finishing, and the
session judges what to start. When the main loop is about to stop and a
run this session started has ended with its task not settled, the stop
is refused, naming the task, its open steps by number and the one call
that settles it, and the turn carries on: the session settles it, or
writes a note on the task saying why it waits (or dispatches the next
leg). With nothing in flight, a stop goes through when the session has
handed off, has no ready task or waits on the user; any other stop with
ready work on the held track is refused once, naming what is left, and
each ready task is named this way once a session. A refusal fires once
per stop: the next stop goes through. The user's hold always wins: the
session records it with `decide`, labels `["hold"]`, naming the track
and quoting the user's words; the track reads "on hold, your word" and
no stop is refused until a decision superseding it lifts it or the track
is taken again.

An agent works its task and writes nothing on it: its own task writes
are refused, and it reports each open step by its number (done, with
the evidence, or not done and why). When its report arrives the mod
attaches the task, its open steps and the settling call, and the session
ticks the steps and closes the task.

AN ENDING ALSO WAKES WHAT WAITS ON IT. A
question snoozed with `--wake-on <ref>` names the record it waits on,
and every ending wakes the snoozed questions whose link names that
record: a task done or dropped, a track done or dropped, a workstream
closed with any outcome, and a question answered or dropped. ANY ending
fires a link, whether or not the link named a status: `--wake-on
T-13:done` records the ending somebody expected, and a drop of T-13
wakes the question just the same, because a dropped record can never
reach the status that was named. The wake rides the ENDING VERB'S OWN TRANSACTION, with one
activity row for each question it woke (`woken by T-13 done`); nothing
polls and no read wakes a link. `reopen` is not an
ending and wakes nothing, and a link survives a reopen to fire at the
next ending. `question-hub.md`'s Snoozing section owns the flag, its
refusals, and what a woken question tells.

## Events

Work has no subscriptions: a session follows work through the track it
holds and the tasks it has in hand, and `subscribe` takes a question
only. Each PC's local server writes a line into a session's inbox for:

- a change to a task, for the session whose run is open on it and the
  session holding its track; a take-over, for the session whose run it
  ended;
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
done or dropped task, a superseded knowledge record) come back with
`--all` or by naming their status with `--status`. A listing prints one
head line per record and a last line saying the records themselves were
not shown; `--json` is an array of the records. Tracks list through
`track list --workstream WS-n`.

`show <id>` routes on the id and prints one record at a READ LEVEL. Its
default is the brief form, NOT the full record, and its last line names
what it left out and the flag that brings it back:

- `--head`: one line (label, name, status, what it waits on).
- A task's status is its word, as `track show` says it: running or
  unconfirmed with who, where and since when, waiting on what, ready to
  start, continue or settle and for how long, done or dropped. A task's
  default read is its block (`task block T-n`), whose first line says
  the word; `--json` keeps the stored `status` beside the `word`.
- the brief form (the default for every record but a task; `--brief`
  asks for it): a head line
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
when it splintered off another track, a junction naming where it left.
Tracks replace threads and plans, and they are the only nesting: no
subtasks, a task carries a checklist instead.

THE STATE. Written, by a verb: `open`, `parked` (with a reason), `done`,
`dropped` (and `folded` on an old track). Derived when read, so it
cannot drift:

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

- **now**: the tasks with an open run, running or unconfirmed, each
  with who runs it: the agent by its job name, or the session. A run
  opens at the dispatch that names the task; no call tags it. Every
  Agent call launches async, with `run_in_background` or without, so the
  session works on while its agents run;
- **ready**: open tasks whose dependencies are all done or dropped and
  that no open question gates, ordered by position, each ready to start,
  to continue or to settle: what can fan out now;
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
(the kickoff without taking it). After a /clear the mod takes the track
back for the session's new id with `resume TR-n --take-over --continues
<earlier id>`: when the earlier id holds the track, the lease keeps its
since, so a hold the user made before still counts. It takes each task
the earlier id held with `task update T-n --in-hand --take-over
--continues <earlier id>`, which moves only that id's session run and
leaves its agents' runs open under it. The mod sends both; a session
never types them.

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
- **A new idea.** `track capture --tier 2 --before T-n --name "..."`
  adds a task to the held track at a real place, and the session carries
  on. Another track (`--tier 3 --track TR-4`), another workstream's inbox
  (`--tier 4 --workstream WS-3 --wake <event>`) or `--task T-20` moving
  an existing task off the held track asks the user first, as any
  filing off it does (Creating, above). `track splinter TR-4 --name
  "..."` starts a side track now: the parent parks with "splintered to
  TR-7 at T-41" as its reason (`--at T-n` names the task it leaves from,
  `--task T-n` moves tasks with it) and the lease moves. From then on the
  chain is in view ("TR-7 under TR-5 under TR-2"), in the status row,
  the splinter's reply and each handoff.
- **Ending one.** `track finish TR-4 --outcome "..."` (done) and `track
  drop TR-4 --reason "..."` end it, `--leftovers inbox --wake <event or
  date>` or `--leftovers drop` for tasks still open; a session's call
  refuses `--leftovers inbox` (it finishes, drops or places each open
  task, and placing asks), which the user's own command keeps. Neither
  goes through while a placement question of the track's work is open.
  A track's goal describes what the track is doing and is never a
  reason to put work off it or to call it finished. At full review depth a finish waits for a review of
  the track's finished code (Review coverage, below); `--waive
  "<reason>"` goes ahead and records why. A finish, a drop and a handoff
  write list the project's inbox as the kickoff does, each due task of
  the track's workstream with the board's call; where the mod runs, the
  turn's end flags such a task left neither placed, woken again nor
  asked about. A due task of another workstream is only named,
  and a task whose wake has not come owes nothing: its wake brings it
  back. When a side track finishes or parks, the result hands
  back its junction and the reply asks the user whether to go back on track
  there; nothing moves on its own.
- **The sweep a track's end offers.** A finish and a drop end with a
  line telling the session to offer the user a sweep of the track's
  sessions (`/askerdo:sweep TR-4`); it is offered, never run, and the
  user also asks for one at any time. `sweep --track TR-4` takes the
  sessions that held the track or wrote its handoffs, `--since
  YYYY-MM-DD` or `--since-last` the project's sessions (since this PC's
  last sweep of it). It reads this PC's transcripts and the board and
  writes, under this PC's data folder (`sweeps/`, the newest five kept),
  never in the repo or on the board: a digest per session with turns
  copied from another session left out, `candidates.md` (every message
  the user typed, and the reply lines that name something left),
  `board-scan.md` (closed tasks whose last note names something left,
  inbox tasks woken with no home) and `brief.md`. The skill hands the
  brief to one reader agent, then gives each lost or stale item the
  nearest home that comes back on its own, under the found work rule: a
  task at a real place on the held track at once, and any other place
  asked of the user.
- **Big tasks.** Any task may carry a checklist of steps, each done by
  whoever runs the task: `check add T-13 --text "..."` (`--at` a
  position), `check done T-13 1` (`--undo`), `check strike T-13 2 --why
  "..."`, `check move T-13 2 --to 1`. A step's number is given when it is
  added and never changes; its progress shows as 3 of 7 wherever the
  task does. A task bigger than its steps, an outcome that takes several
  jobs, lays its parts out as tasks on the track (`track layout`) with
  the closing task waiting on them by edges.

THE HANDOFF. Where the mod runs, its `handoff_write` tool writes one
(load it first with ToolSearch, query `select:mcp__askerdo__handoff_write`);
elsewhere `handoff write TR-n` takes the payload on stdin. The CLI and
the tool share one check (`lib/handoff-payload.mjs`):

- `goal`: what the track is doing now, in a sentence or two, restated
  at each handoff. When it differs from the stored goal the write
  rewrites the goal as a note with `--goal` does, the old text kept in
  the track's history with the handoff as its why, and the next kickoff's
  Goal line says it was restated and what it was.
- `focus` (required): the one next action, one line of at most 400
  characters.
- `state` (required): at most 10 KB, and no `## Where we were` heading
  of its own. A line over 400 characters is wrapped, not refused: it is
  cut at the last sentence or clause end before 400 (else the last
  space) and the rest goes on a continuation line indented two spaces,
  so a bullet stays one bullet. Lines in a fenced block, table rows and
  a single word over 400 pass whole. The 10 KB counts the wrapped text,
  and the write's result says how many lines it wrapped. A state op of
  `handoff update` wraps its text the same way.
- `whereWeWere`: the previous session's own words, at most 4 KB, wrapped
  as `state` is.
- A `focus`, `state` or `whereWeWere` over its budget is stored as sent,
  never refused, so the write takes one call; its result names each
  field over and the `handoff update` op that shortens it: `{ op:
  "focus", text }`, `{ op: "state", heading, text }` for a long
  section, or `{ op: "whereWeWere", text }`, which replaces it whole.
- `waitingOnUser`: a list of one-line items.
- `leftovers`: the steps left, laid out on the track as `track layout`
  lays them, each naming its `runBy`. One for later work names
  `newTrack` (a name) and `unparkWhen` (`"track-ends TR-n"`,
  `"task-completes T-n"`, or a leftover's number, `"task-completes 2"`,
  or `"question-answered Q-n"`): the write makes that track in the
  workstream, lays the step on it and parks it until the event; leftovers
  naming the same name share it. A step that files new work or moves a
  task names its place as a filing does (Creating, above): a step at a
  real place on the track lands with the write, and each step asked
  last, off the track or for a later session becomes its own placement
  question, named in the write's result; one naming a task already on
  the track places nothing and needs none. A task's close takes the
  same steps.
- `rulings`: rulings made in chat and not yet registered. A string is a
  new ruling; each carries to every next handoff as R1, R2 until the
  writer marks it `{ "id": "R2", "registered": "Q61" }`.
- `verifyFirst`: one entry per repo (`path`, `branch`, `worktree`,
  `commit`, `ownedByOthers`, `files`, `worktrees`); the `commit` and
  `branch` are read from the repo at write time, a given one git
  disagrees with is not stored and the result names it, and the write takes a
  snapshot of its dirty and untracked files, its other worktrees and its
  local branches merged into the checkout's. `files` gives each untracked
  file a disposition (Loose files, below), `worktrees` each worktree
  holding work and each group (Worktrees and merged branches, below).
- `status` (`waiting` by default, or `parked` with `parkReason`),
  `depthAtHandoff`, and `created` (a full stamp, for an import). Unknown
  keys are refused.

The write issues the label one past the track's chain, supersedes the
live handoff, lets the writer's lease go (a parked handoff parks the
track) and ends the writer's open runs as handed on, so their tasks read
ready to continue. Its result names each run whose branch is not on the
remote as this PC last saw it: push each, or say in the handoff why it
waits, since the next leg may run on another PC. The board keeps each repo's summary, `{ path, branch, worktree,
commit, ok, problems }`; the snapshot and the loose-file, worktree and
branch lists stay on this PC, in `<data>/handoffs/<TR-n.m>.json`. The
result carries the resume line, `/askerdo resume TR-n`, which the reply hands the user alone in
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
any file missing or over budget. A resume gives no task back in hand:
the handoff ended those runs, and the session takes what it judges.
Where the mod runs, `/askerdo resume TR-n` hands the kickoff to the
session as a prompt, which starts a model turn.

THE KICKOFF is printed from the board, never stored, and is an index:
line one names the track and the resume command, then the due inbox
tasks of every open workstream in the project ("Due for a home", each
naming its workstream and any question to the user about it, with the
place command for the track's own workstream's; another's are only
named), the chain, the junction, the focus (or "no handoff yet"), then
what has a run behind it and what is ready, in five sets with their
counts: "Unconfirmed (n)", "To settle (n)" (an agent finished and the
task is not closed: its steps by count, never their text), "To continue
(n)" (the last run handed on, failed, was taken over or was closed by
the app), "Ready to start (n)" and "Running (n)", each row
with who ran it and how long it has been ready; then the critical path
and its length, the rest of the tasks in dependency order with their
checklist progress; to the track's holder, its open tasks nothing
waits on with the same confirm or wire ask as the handoff's result; side
tracks, stalls in the workstream; to the holder, the inbox of every open
workstream in the project (each open task on no track, oldest first,
with its workstream and its wake, or "due"), asking it to put each on a
track, move it to the workstream it belongs in, give it a new wake, or
ask the user; what
waits on the user (less what was answered since), the answers since, the
unregistered rulings with their count, one `Read:` line for the
workstream's handoff folder (rules.md whole, map.md by grep, each with
its budget or long-line warning; read through this PC's project map, and
when this PC has no folder for the project the line says so and names
`projects scan`), and then the handoff's state, where we
were and the session that wrote it; a resume on this PC adds the loose
files, worktrees and merged branches below. The task list never comes
from the handoff's prose.

THE HANDOFF FOLDER is a workstream's `handoff` field (`ws create
--handoff <dir>`, `ws edit WS-n --handoff <dir>`; absolute or under its
first project). The board keeps a project by its shared name only, so each PC finds the folder through its project map: the
session's own checkout when it is one of the project's (a worktree
too), else the map's folder; a project this PC has no folder for is
said so, never guessed. A folder that does not exist yet is made from the
plugin's `templates/handoff/` (README.md, now.md, rules.md, map.md;
budgets 5, 10, 11 and 16 KB, no line over 400 characters); an existing
one is only recorded.

### Review coverage

The board keeps the commits each task finished with and the reviews that
read them. The mod links every commit a session or its agents make, with
no call from you: the task ids its subject line leads with first, else
the tasks of the committing agent's run, else the task the session has
in hand (the newest, marked a guess, when several are). So lead every commit's
subject with its task id (`T-13: ...`); an id cited later in the
message links nothing. A handoff, a resume and `coverage TR-4 --scan`
link commits made outside a session whose subjects lead with a task
id; `commit move <sha> --to T-14 --reason "..."` relinks one by hand.

- **Code task:** one with a linked commit that changed counted source
  (code and tests; never lockfiles, generated files, Markdown, docs,
  fixtures or binaries, nor the files `review.ignore` names).
- **Review task:** labelled `review`, whatever its name (a step laid out
  or a task made with a review scope gets the label). Placing it
  is your judgment, by the built-in review-stations rule line, laid out
  on the track like any step. Closing it as done covers every unreviewed
  code task on its track that finished before its first run started; `review covers T-30
  T-21 T-22` (the mod's `review_covers` tool; load it first with ToolSearch, query `select:mcp__askerdo__review_covers`)
  sets the list instead.
  `task create --review-scope project` (or `reviewScope` in a layout
  step) makes one that reads the project's code tasks since the last
  project-wide review, and the commits no task owns: use it before a
  release that ships other tracks' work.
- **Due:** a track whose unreviewed code tasks reach `review.tasks` (5)
  reads review due on the Tracks tab, in the kickoff and the handoff.
  `coverage TR-4` (`WS-n` for a workstream; the mod's `coverage` tool;
  load it first with ToolSearch, query `select:mcp__askerdo__coverage`)
  lists each code task with the review covering it. The line's `track
  layout` call runs as printed, as the shell's own session: the step
  goes after the unreviewed tasks and before the track's first mid-track
  review or look, else its last work in order, else its closing review.
- **After a review:** a done review stays done. A
  commit on a task it read, or a task before it finishing after it,
  leaves that task unreviewed: it counts on the review-due line, and the
  next review station or the track's closing review reads it. A review
  the board reopened before this rule, with nothing new to read since,
  is named on the review-due line for the session to close; the board
  closes none, and closing one keeps its covers as they stand.
- **Depth:** `review.depth` `light` (the default) only nudges. At `full`
  `track finish` is refused while finished code sits uncovered after
  the last done review, work committed after it included
  (`--waive "<reason>"`). `off` computes nothing.

### Loose files

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
five files still unknown, one agent looks at those; what is left
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
- The handing-off session asks: the write's result names the
  undecided and due files, and that session asks the user in the same
  reply through the ask tool, after the write, with the paths and how to
  check each again in the ask's context. On the answer it checks again,
  acts or keeps, and patches the handoff with `handoff update` (its
  `verifyFirst` op); an answer that lands after a resume reaches the
  session holding the track, which does the same and asks nothing again.
  A resume asks nothing: the kickoff prints one line of what is kept and
  why, and a keep past its review day is asked about at the next handoff.
  Nothing raises a question on the board by itself.
- A track nobody has resumed shows its due files as a count on its tile
  in the AskerDo pane's Tracks tab (a track to pick up or a parked one),
  read from this PC's lists, so a handoff written on another PC shows
  none here. The count is never a question.
- Answers act, nothing else does: on the user's yes the session carries
  out the commit, ignore or delete for that file only. No verb deletes,
  commits or edits an ignore list.

### Worktrees and merged branches

The same snapshot reads every worktree of a listed repo (`git worktree
list`, the agent worktrees under `.claude/worktrees/` and sibling
checkouts alike) and every local branch merged into the checkout's
branch, and sorts them three ways:

- **Merged and clean:** its branch is in the checkout's branch, with
  nothing uncommitted and nothing untracked. All of them are one group,
  `merged`, proposed for removal as one item with their branches.
- **Holding work:** commits not in the checkout's branch, changed files
  or untracked files. Each is listed on its own with what it holds and a
  disposition, `remove`, `keep` (with a `reason`) or `undecided`.
- **Merged branches with no worktree:** one more group, `branches`,
  proposed for deletion as one item. A branch with an upstream and
  `main`, `master` or `trunk` are never in it.

Never judged: the checkout itself and the repo's main worktree, a locked
worktree (the Agent tool locks a running agent's, `locked claude agent
<name> (pid n)`), one under `ownedByOthers`, and one made in the last
12 hours with no commit in it (one the session may be setting up). A
worktree inside the checkout is never a loose file as well.

The payload's `worktrees` list gives `{ path or group, disposition,
reason, review }`; one it leaves out carries what this PC kept for it in
`<data>/kept/<repo slug>.json`, else a group is proposed for removal and
a worktree holding work is undecided. The flow is the loose files' flow:
a group and an undecided or removed worktree are due at once, a kept one
on its review day. The write's result lists the due ones ("Worktrees: 3
merged and clean (proposed removal, due, with their branches): ...; 1
holding work: ...") and the handing-off session asks the user in that
reply, one ask per group and one per worktree holding work, before
anyone acts, as for the loose files above. A track nobody has resumed counts them on its Tracks tile
beside its due files, each kind named and a group counted once ("2 loose
files and 1 worktree group due"; the merged branches are a branch
group, a worktree holding work a worktree). A list past 200 names keeps
its count and its first names.

Agent worktrees are removed without a question. A session that
merges an agent's lane removes that agent's worktree and deletes its
branch then. The handoff write does the rest before its snapshot: an
agent worktree (under `.claude/worktrees/`, or on a `worktree-agent-`
branch) whose branch tip is in the checkout's branch, with nothing
changed and nothing untracked, goes with `git worktree remove` and its
branch with `git branch -d`, and a merged `worktree-agent-` branch with
no worktree is deleted; the result lists each. Never the checkout, the
session's own worktree, the main one, a locked, gone or just-made one,
or one under `ownedByOthers`; git's own refusals of a dirty worktree or
an unmerged branch stand behind the check. Nothing else is removed,
deleted or pruned.

## Knowledge

A **knowledge record** (`K-n`) is a gotcha or a decision: a fact, not
work. It is private and cross-project.

- Fields: `name` (the title), `type` (`gotcha` or `decision`), `status`
  (`active`, or `superseded` or `withdrawn`, both terminal) with
  `supersededBy`, `scope` (`project` with `projects`, repo roots, or
  `global`), `labels`, `refs`, `files` (repo globs: an edit of a match
  points the session at the record, once), `legacy` (the old
  `<slug>:<id>`, empty for new records), `source`. Body: `## Description` (the title), `## Body` (the
  text), `## Journal`.
- `knowledge new` warns when two of the title's longest words reach an
  existing record. Search before writing one.
- `knowledge edit K-n` rewrites `--name` or `--body` in place only while
  the record is unused (no other session read it, and no record links or
  refers to it); `--add-ref`, `--remove-ref`, `--add-project`,
  `--remove-project`, `--add-file` and `--remove-file` work at any time.
  Once it is used, `knowledge amend` appends a dated clarification and
  `knowledge supersede` replaces it.
- No inbox line and no subscribers. `note`, `show`, `list --kind
  knowledge` (`--all` brings back superseded records) and `search --kind
  knowledge` (question-hub.md, The activity log) serve it; the generic `edit`, `close` and `reopen` refuse it.
- Migration only: `--legacy <slug>:<id>` (refused when that id already
  has a record) and `--created <date>`.

```bash
node ~/.claude/askerdo/cli.mjs knowledge new --type gotcha --title "..." --project C:/Demo/tidewatch < body.md
node ~/.claude/askerdo/cli.mjs knowledge supersede K-12 --title "..." < body.md
node ~/.claude/askerdo/cli.mjs search cleartype --kind knowledge
```

Old brain ids (`G-0071`, `D-0002`, `T-0013`, qualified as
`tidewatch:G-0071`) map through `legacy <old id>` (`--project <slug>`).

## Profiles

Depth settings and the rules an agent brief carries come from named
profiles that a record subscribes to, the narrowest winning per setting:
built-in < `default` < a project < a workstream < a track < a task. A
session's settings come from the track it holds, else its project; its
rules from the track it holds, else its newest open run's task, else its project.

- `profile define <name> --set key=value` (repeatable), `--unset key`,
  `--description`; keys `main.on`, `main.window`, `main.wrap` (percent),
  `agent.on`, `agent.soft`, `agent.hard`, `agent.remind` (tokens, `350k`
  reads as 350000), `agent.hardDeny`, and the test and dispatch rules
  (`tests.policy`, `tests.fullRun`, `tests.pinWording`,
  `dispatch.stateNote`, `dispatch.outputRule`, `dispatch.inject`). The
  rules block's lane size line is `agent.soft`, the guard's own soft
  limit, so moving the guard moves it. The built-in level
  also carries a few rule lines (`--rules` lists each with its slug),
  which a profile drops with `rule-drop`. The block reaches every
  session's prompt and each agent it dispatches, a plain session's
  included.
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
  session|agents|agents:<role>|both] [--profile <name>]` is the rule write the pane and
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

A task a session closes as `done` or `dropped`, or a workstream it
closes, raises one card in the tray's popup when the session passed its
own session id, so long autonomous work announces its endings to whoever
is at the machine. Each ending reads its own row in `board/notify.json`
(`task-completed`, `task-dropped`, and `plan-closed` for a workstream):
whether it shows and which sound it rings. An ending's card names the
record and the ending (`counter rebuild done`), with the project
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

## Every task and track call, in full

The task and track calls past the routine ones in
[askerdo-quick.md](askerdo-quick.md), with the routine ones beside them.

### Tasks

- Status: `open`, `done` when it lands where its Intent says, `dropped`.
  Everything else is the task's word, read and never set: running,
  unconfirmed, waiting, or ready to start, to continue or to settle.
  What a task waits on is a "depends on" edge, a gate or a wake, never a
  status.
- `task update T-13 --in-hand --session <own-id>` (the mod's
  `task_update` tool, `inHand`) takes it in hand and opens the session's
  run; a session may hold several. `--let-go` ends the run, `--reason
  "..."` starts one that is not ready, `--note "..."` journals it. An
  agent's run opens at the dispatch that names the task. A task whose
  open run belongs to another session is refused naming the holder;
  `--take-over` with `--in-hand`, or with a close over that run, moves
  it only once the user says so, the holder told.
- **A close carries its leftovers**, so nothing found while doing a task
  is left in its closing note: `task update T-13 --status done
  --leftovers --session <own-id>` reads a JSON list of steps on stdin
  (the `task_update` tool's `leftovers`), each `{ "name",
  "description", "runBy", ... }` with its place as a handoff's
  leftover, or `{ "check": 2, "runBy", ... }` for an open step, which
  takes the step's text. A step at a real place on the task's own track
  (`after`, `before`) becomes a task with the close; a step asked last,
  on a new parked track (`newTrack` with `unparkWhen`), in the inbox
  (`unplaced` with `wake`) or anywhere else off the track carries its
  reason and `here`, and becomes the user's placement question, created
  only on their press. A refused step leaves the task open with nothing
  filed. A close is refused while a step is
  open: `--check-done`, `--check-strike "n: why"` or a leftover naming
  the step settles it in the same call.
- **A step someone else does moves:** `task update T-13 --move-steps
  --session <own-id>` reads `[{ "check": 2, "onto": "T-20" }]` (onto an
  open task), `{ "check": 2, "question": "Q60" }` (a question already
  asked) or `{ "check": 2, "runBy", ... }` (a new task, placed as a
  leftover is; a move onto a task on another track is asked) on stdin, each step struck with where it went; a close
  goes in its own call.
- `task edit T-13 --close "with T-12"` closes it when T-12 is done, while
  automatic upkeep is on, and through the same gate on open steps;
  `--clear-close` takes the condition off.
- **Work only a later session can do:** `--wake next-session` with
  `--tier 2` on the held track, `--tier 3 --track TR-n`, or `--tier 4
  --track TR-n` in another workstream (or `task edit T-13 --wake
  next-session` alone on a task on a track), with its reason and
  `--here-before` when a task on the held track waits on it: the user is asked first, and once created it waits
  for the filing session and reads ready in another's kickoff.
- **A look** is a task labelled `look` that the session runs, ending in
  one question to the user that gates it (`ask` with `gates`, or
  `question edit Q60 --add-gate T-13`); the session closes it once the
  answer is right.
- `task create --json < payload.json` (`name`, `description`; usual
  `intent`, `workstream`). `note T-13 --body "..." --session <own-id>`
  journals a task, workstream, track or knowledge record; with
  `--name`, `--description`, `--intent` (a task) or `--goal` (a track) it also
  rewrites that text, the note being the why and the old text kept in
  `show T-13 --history`.
- **Work for later goes on a parked track**, never the inbox, once the
  user approves that place (a placement off the held track is asked):
  a tier 3 filing with `--unpark-when "task-completes T-13"` and
  `--new-track "<name>"` makes and parks the track on their press. An unplaced reason that says no track carries the work is refused
  with those commands. Every inbox filing names its wake, or the board
  refuses it with both ways out: `--wake "track-ends TR-5"`,
  `"task-completes T-13"`, `"question-answered Q60"` or a date
  `2026-12-01` still to come (a fired one is refused), on `task create`,
  `task edit`, `track capture` and `track finish|drop --leftovers inbox`;
  one with none stored is due 14 days after it entered the inbox. Once
  its event ends or its date comes it is due: `task edit T-21 --wake ...`
  wakes it again, and the third wake in one inbox stay goes to the user
  as a question instead (place it, keep it with a new wake, or drop it).
  The inbox never takes work waiting on the end of the track you hold:
  a wake of `"track-ends TR-4"` from the session holding TR-4 is refused,
  since that work is a step on TR-4 (`--track TR-4 --after T-n`).
  `track found TR-4` (`--since handoff`) lists what the arc filed, each
  with where it went and the command that moves it; the handoff, the
  kickoff and a question gating a release task (named Release..., or
  labelled `release`) show the same, so the user reviews it at each gate.
- **A ruling the user makes in chat** is recorded the same turn: the mod's
  `decide` tool, else `decide --session <own-id> --json < decision.json`
  (`title`, only what the user chose; `words`, theirs, quoted whole;
  `confirmed` when the user said yes to the title as worded;
  `body`, where your own picks go, each named as your pick; what it
  governs: `tasks`, `files`, `commands`; `supersedes` a K-n; `question`,
  the Q-n it answers: words carrying `167a` or `Q167 a` record the answer,
  else the result says it is still open). Words ending in a question back
  or a hedge (thoughts?, perhaps) still record, and the result warns that
  they leave the choice open. The title, with the restatement in its
  body, is the statement the user confirmed: tasks, briefs and notes
  carry it and the K-n, and the words stay in the record; a brief quotes
  the confirmed statement word for word, and a ruling not confirmed yet
  in the user's words. `knowledge edit K-7 --confirmed` marks an
  existing record. `decisions --task T-13` (`--track`, `--workstream`,
  `--since`) lists the ones in force.
- **Changing one once used:** `knowledge amend K-7 --body "..."` appends a
  dated clarification and keeps the number; `supersede` is for a change of mind.
- **In place only while unused:** `knowledge edit K-7 --name` or `--body` (and
  `task edit T-13 --intent "..."` before its work starts) is refused once another
  session read it; a record's refs, projects and files change at any time.
- **A fact about one area of the code** names its files: `knowledge new --type
  gotcha --title "..." --file 'src/db/**'` (repeatable; `knowledge edit K-7
  --add-file` or `--remove-file` at any time). A session editing a matching
  file is pointed at it, once.
- **Override, the user's press:** `override request K-7 --kind fix|withdraw|scrub
  --reason "..." --summary "..." --session <own-id>`, only for a bug's text, a
  ruling never made or a secret; never wording, scope or a change of mind. A
  subagent reports to its session and never asks. Where the mod runs, ask
  with its `override_request` tool (load it first with ToolSearch, query `select:mcp__askerdo__override_request`)
  and tell the block it returns as written.
- `override unscrub K-7 --user <session>` puts a scrubbed text back within 7 days.
- `show K-7 --history` prints a record's old texts. `show` logs your read
  under the session Claude Code names in the shell; `--session <own-id>`
  where none is named.

### Tracks and handoffs

A track (`TR-n`) is a line of work in a workstream; its handoffs
(`TR-n.m`) are checkpoints. One session holds one track. Where the mod
runs, `/askerdo resume`, `/askerdo track`, `/askerdo park`, `/askerdo
handoff` and its `handoff_write` tool drive it; hand off at the 30
percent window, and before anything else past 40. Elsewhere:

- **Find:** `shelf`, `track list --workstream WS-3`, `track show TR-4`.
- **Take:** `resume TR-4 --session <own-id>` prints its kickoff, an
  index of what to settle, continue and start, and gives no task back in
  hand; it asks nothing about leftover files and worktrees, and its kept line
  says what stays and why. A held
  one names its holder and `--take-over`, `--splinter "<name>"`,
  `--read-only`; one unseen past `tracks.quietHours` (12) reads "held,
  quiet since". **Start:** `track new --workstream WS-3 --name "..."
  --session <own-id>`.
- **Hand off:** `handoff write TR-4 --session <own-id> --json <
  handoff.json` (`focus`, `state`, `verifyFirst` per repo with a
  disposition per untracked file in `files` and, in `worktrees`, per
  worktree holding work and per group: remove, keep or undecided; the
  write finds the worktrees and merged branches itself, removes the
  merged, clean agent ones and lists them, and the reply asks the user
  about the rest through the ask tool); the reply hands the user `/askerdo
  resume TR-4` alone in a copy block. Talk that goes on after it is
  patched in, keeping its id: `handoff update TR-4 --session <own-id>
  --json < ops.json` (the mod's `handoff_update`;
  load it first with ToolSearch, query `select:mcp__askerdo__handoff_update`); once another session
  holds the track, `note TR-4 --body "..."` reaches it at its next prompt.
- **End:** `track park TR-4 --reason "..."` (`--unpark-when
  "task-completes T-13"`, `"track-ends TR-5"` or `"question-answered
  Q60"` unparks it then), `track finish TR-4 --outcome "..."`. A finish
  or drop ends with a line to offer the user a sweep of the track's
  sessions for anything left behind (`/askerdo:sweep TR-4`): offer it,
  never run it unasked.
- **A new idea:** `track capture --track TR-4 --name "..."` and carry
  on, or `track splinter TR-4 --name "..."` to move onto it now. A
  separable area of existing tasks branches with `--no-park --at T-n
  --task T-n`: TR-4 stays open, the side's first tasks wait on T-n.
- **Order:** lay a line of work out before starting it: `track layout
  TR-4 --session <own-id> --json < steps.json` (`{ "steps": [{ "name":
  "...", "after": [1], "before": ["T-20"] }] }`, `after` naming T-n ids
  or earlier step numbers, `before` the T-n ids that wait on the step;
  a name matching an open task there is that task); a
  handoff's steps left go in its `leftovers`, the same list, never as a
  Next list in the state; each leftover names its `runBy` (`orchestrator`,
  `fork`, `agent:<model>`), which the kickoff prints, and
  `task edit T-14 --run-by orchestrator` changes it. A leftover for later
  work names `newTrack` (a name) and `unparkWhen` (`"task-completes 2"`
  may name a leftover by its number): the write makes that track in the
  workstream and parks it until the event. `edge add T-14 T-13 --reason "..."` (T-14
  waits on T-13); `track reorder T-14 --before T-13 --reason "..."` (or
  `--after`, `--position N`) moves a task in its track's order. A
  handoff's result and the kickoff name the open tasks nothing waits on
  but the longest chain's end: confirm each in the reply as an end on
  purpose, or wire it with `edge add`.
- **Reviews:** lead every commit's subject with its task id (`T-13: ...`);
  the mod links each commit to the ids its subject leads with, never to
  one cited later. A review task (labelled `review`;
  a review scope labels it) covers, on completion, the code tasks on its
  track finished before it started (`--review-scope project`: the
  project's since the last project-wide review); `review covers T-30
  T-21` sets the list, `coverage TR-4` lists what waits unreviewed, and
  `commit move <sha> --to T-n --reason "..."` relinks a commit. A
  commit after a done review leaves it done and counts for the next
  review. At `review.depth` `full` `track finish` waits for a review
  (`--waive "<reason>"`).
- **Inbox:** the kickoff lists every open task on no track in the
  project's open workstreams, each with its wake; put each on a track
  (`track capture --track TR-4 --task T-20`), move it (`task edit T-20
  --workstream WS-5`), give it a new wake (`task edit T-20 --wake ...`),
  or ask the user. A due one of any workstream in the project leads every
  kickoff in its own "Due for a home" line. At a track finish, drop or
  handoff write, a due inbox task of the closing track's workstream is
  placed or woken again by the turn's end; naming it in the reply settles
  one not yet due, another workstream's, or one the user is asked about.
- **Upkeep:** `upkeep --dry-run` lists what automatic upkeep would
  unpark, close and put on Home; `upkeep on`.
- **Speed:** `timings` prints p50 and p95 per verb from this PC's local
  server and the board, and the board's last check.
- **Folders:** the board names a project only by its shared name (its
  git remote, else its main checkout's path); `projects` lists this PC's
  folder for each, learned at session start, and `projects scan
  <folder>` maps a checkout (or the checkouts in a folder) the kickoff
  says has no folder here. The listing marks an entry whose folder is
  gone or is now another project; `projects forget <name>` drops it.
