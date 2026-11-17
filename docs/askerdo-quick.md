# AskerDo quick reference (read this at the first board touch)

The calls a session makes on most days. The rest is in
[question-hub.md](question-hub.md), "Every question call, in full"
(engagement, a question's lane, rulings, the names line), and
[work-system.md](work-system.md), "Every task and track call, in full"
(found work and parked tracks, wakes and the inbox, moving steps,
closing with another task, a look, knowledge, overrides, capture and splinter, order and
edges, reviews, the sweep offer, upkeep, timings, folders).

```bash
node ~/.claude/askerdo/cli.mjs <verb> [args] --json
```

- Every write goes to the board at once and nothing queues: when the
  board cannot be reached a write fails plainly, so keep the question in
  the reply and say so.
- Exit 0 success; 1 bad input, a refusal or an unreachable board; 2 a
  failure in the CLI or the local server. "It may have run" means read
  before trying again.
- Pass `--session <own-id>` (the id in the scratchpad path) on every
  write that takes it. `<verb> --help` prints one verb.
- `show T-13` prints the task's block, its first line the task's word
  (running, unconfirmed, waiting, ready) with who and since when; its
  last line names what it left out (`--full` is all of it, `--history`
  the old texts).

## Questions

Where the mod runs, its tools (`ask`, `answer`, `decide`) do each of
these; a session not yet engaged with the board keeps its question
local (`L1`) until it engages.

- **Ask:** register before the first telling: `register --json <
  payload.json` with `name`, `ask` (one plain question ending in `?`,
  options by letter, the pick marked "(a, my pick)"), `gist`,
  `projectDir`, `session`, `blocking`; usually `crux`, `stakes`,
  `options` (`{type, option, getsYou, costsYou}`), `pick`, `gates`.
  Reopening an answered one takes `revisits` and a `reversal`; one that
  only mentions it takes `cites`.
- **Answered in chat:** each token (`106b`) its own answer: `answer Q106
  --pick 106b --note "..." --session <own-id>`; a decline `drop Q106
  --note "..."`; a deferral `snooze Q106 --trigger "next session"`.
- **Fix one, never re-register:** `question edit Q106` (`--workstream`,
  `--track`, `--pick`, `--add-gate`, or the whole reworded payload on
  stdin); `surface Q106 --session <own-id>` before telling one you did
  not register.
- **A ruling the user makes in chat** is recorded that turn: `decide
  --session <own-id> --json < decision.json` (`title`, only what the user
  chose; `words`, theirs, whole; `body`, your picks named as yours; what
  it governs; `question`, the Q-n it answers; `confirmed` when the user
  said yes to the title as worded). The title, with the restatement in
  its body, is the statement the user confirmed: tasks, briefs and notes
  carry it and the K-n, and the words stay in the record.

## Tasks

- A task's status is `open`, `done` or `dropped`; its word (running,
  unconfirmed, waiting, ready) is read, never set. Start one yourself
  with `task update T-13 --in-hand --session <own-id>`; a dispatch
  naming it opens its agent's run. Close it `--status done` when it
  lands where its Intent says, `--status dropped` otherwise.
- **A task ready to settle** ("ready to settle: home-nodes finished, 2
  steps open") is the track holder's: each open step done
  (`--check-done 2`), struck with a word why (`--check-strike "2:
  why"`), or filed as its own task (a leftover naming the step), in the
  close's own call. A close with a step open is refused.
- **Found work gets its home the turn it is found.** Only a real place
  on the track you hold is free; anywhere else is the user's call:

|Where it goes|The call|
|-|-|
|an open task that already covers it|`note T-13 --body "..."`|
|a plain defect in the work in hand, one right fix, this turn|fix it, file nothing|
|a step on the task whose worker will do it, in hand or not|`task update T-13 --check-add "..."`; a step of yours someone else does moves with `--move-steps`|
|a real place on the track you hold|`task create --tier 2 --before T-n` (and `--after`): filed at once. With nothing else open on the track it files at once and is taken next|
|last on your track, or anywhere off it (another track, a new or parked track, another workstream or project, an inbox, a later session)|the same call with the place you want (`--last "<why>"`; `--tier 3 --track TR-5` or `--unpark-when "task-completes T-20"`; `--tier 4 --workstream WS-2` with `--track` there or `--wake`; `--wake next-session`), its reason (`--why-elsewhere "<why>"` off the track) and `--here-before T-n` (and `--here-after`), the real place on your track it would otherwise take: nothing is created; the user's question shows both places and presses do it on this track, put it where asked, let's talk where it fits, or drop it|
|anything only the user can decide or do|a question (`gates` names the task)|

- The press creates the task with no model turn. After "let's talk",
  file the settled place with `--question Q-n --words "<the user's
  settling words>"`. A track is not finished while a placement question
  of its work is open. A session that holds no track files as before.
- `task create --json < payload.json` (`name`, `description`; usual
  `intent`) takes the flags above; a date `--wake` names why that date
  in `--unplaced`. Where the mod runs, its `place` tool takes the same
  fields (`here` for the real place). A refusal names the call that
  fits: send it.
- **A close carries its leftovers:** `--status done --leftovers`
  reads a JSON list of steps (`{ "name", "description", "runBy" }`, or
  `{ "check": 2, "runBy" }` for an open step, with its place:
  `after`/`before` on your track, or the place asked with its reason
  and `here`) on stdin. Each step follows the same rule: one at a real
  place lands with the close, and each asked step becomes its own
  placement question.
- **A step someone else does** moves before the close: `--move-steps`
  reads `[{ "check": 2, "onto": "T-20" }]` (or `"question": "Q60"`, or
  a new task's `runBy` and its place) on stdin; a step moved onto a task
  on another track is asked like any off-track filing.
- **A look** is a task labelled `look` that ends in one question to the
  user gating it. **A hold:** when the user says hold, `decide` with
  labels `["hold"]` on the track, in their words. **A refused stop:**
  settle the task it names, or write a note on it saying why it waits.
- `note T-13 --body "..." --session <own-id>` journals a record; with
  `--description`, `--intent` (a task) or `--goal` (a track) it rewrites
  that text too, the old text kept in `show T-13 --history`.

## Tracks and handoffs

One session holds one track (`TR-n`); its handoffs (`TR-n.m`) are
checkpoints. Where the mod runs, `/askerdo resume`, `/askerdo park`,
`/askerdo handoff` and its `handoff_write` tool drive it. The mod's
board tools (`handoff_write`, `handoff_update`, `override_request`,
`review_covers`, `coverage`) are deferred: load each first with
ToolSearch, query `select:mcp__askerdo__<name>`. So is `drawn`, which
reads what this session's pane, band and status row last drew, as text,
before the user is asked to look at them (`docs/procedures/look-check.md`).

- **Take:** `resume TR-4 --session <own-id>` prints its kickoff, an
  index (to settle, to continue, ready to start) that gives nothing back
  in hand; take what you judge, settling first, and ask nothing about leftover files or worktrees:
  its one kept line says what stays and why. `track new --workstream WS-3
  --name "..."` starts one; `track layout TR-4 --json < steps.json` lays
  out its steps.
- **Merge:** merging an agent's lane removes its worktree and deletes its
  branch then, with no question.
- **Hand off:** `handoff write TR-4 --session <own-id> --json <
  handoff.json` (`goal`, `focus`, `state`, `verifyFirst`, `leftovers`)
  restates the track's goal (a changed one replaces the stored goal, the
  old text kept in its history), places the leftovers under the found
  work rule, ends your
  runs as handed on, names each branch not on the remote (push it, or
  say why it waits), and removes each merged, clean agent worktree and
  merged agent branch still left;
  ask the user about the rest (unmerged work, a file with no disposition)
  in that reply. The reply hands the user `/askerdo resume TR-4` alone in
  a copy block. Later talk goes in with `handoff update TR-4 --json <
  ops.json`.
- **End:** `track park TR-4 --reason "..."` (`--unpark-when ...`) or
  `track finish TR-4 --outcome "..."`. A track's goal describes what
  the track is doing and is never a reason to put work off it or to call
  it finished.
- Lead every commit's subject with its task id (`T-13: ...`).
