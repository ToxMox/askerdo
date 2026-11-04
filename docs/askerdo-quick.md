# AskerDo quick reference (read this at the first board touch)

The calls a session makes every day. The rest is in
[question-hub.md](question-hub.md) (the board, every question flag,
labels, `login`) and [work-system.md](work-system.md) (read levels,
outcomes, checklists, the handoff payload, loose files, profiles).

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
  write that takes it.
- `show T-13` prints the brief form, NOT the whole record; its last line
  names what it left out (`--full` is all of it). When the work needs
  what a cut read left out, read that part before acting on it.
  `<verb> --help` prints one verb.

## Questions

- **Engaged or not:** a session engages the board only through the
  user's own acts (an `/askerdo` command, a board id typed in a prompt,
  acting on a board item) or a kickoff that hands it an id; its own
  question never engages it. Until then the `ask` tool keeps a question
  with the session under a local label (`L1`, answered `L1a`) on the
  card and the band, the mod records an answer given there with no CLI
  call, a typed `L1a` goes through the `answer` tool, and
  on engagement files it on the board (answered ones with their answer)
  and tells its new label once. The mod refuses a CLI `register` from a
  session not engaged and points at `ask`. One left unanswered when the
  session closes is gone.
- **Register before the first telling:** the mod's `ask` tool where it
  runs, else `register --json < payload.json`. Required: `name`, `ask`,
  `gist`, `projectDir`, `session`, `blocking`. `ask` is one plain
  question ending in `?` naming the options by letter with the pick
  marked ("... (a, my pick), or ... (b)?"); `gist` is why it came up,
  carrying what answering needs (the items, counts and consequences),
  never a pointer to a report. Usual: `crux`, `stakes`, `options` as
  `{type, option, getsYou, costsYou}`, `pick` (a letter, or `null` on
  purpose), `gates` (`T-n`).
- **Its lane:** left out, the track is the one you hold and the
  workstream that track's, else that of the tasks you have in hand,
  else your subscriptions'; several are refused naming the tasks (name
  one), none files it in the project's inbox. The board adds `pc`, the
  asking PC's name. A question belongs to the session holding its
  track, so the session that resumes the track owns it.
- **Rulings:** reopening an answered question takes `revisits:
  ["Q512"]` and a `reversal` and is told alone, in a reply of its own;
  one that only mentions it takes `cites: ["Q498"]`. An answered
  label bare in the free text without either is refused; an old
  queue's question is named by its title, and a label inside a file
  name or path is not read as one.
- **Answered in chat:** the token is the number plus the letter
  (`106b`), each token typed its own answer: the mod's `answer` tool
  (`id`, `pick`, `note`; `drop` for a decline) where it runs, a local
  label only there, else `answer Q106 --pick 106b --note "..." --session
  <own-id>`; a decline `drop Q106 --note "..."`; a deferral ruled aloud `snooze
  Q106 --trigger "next session"` (or `--until YYYY-MM-DD`, `--wake-on
  T-12:completed`).
- **Fix one, never re-register:** `question edit Q106 --workstream
  WS-3` (`--track TR-3`, `--pick b`, `--add-gate T-12`). An open one
  whose ask or options must change is reworded in place, keeping its
  number: the `ask` tool with `edits: "Q106"`, or `question edit Q106`
  with the whole reworded payload on stdin; tell it again in full.
  Telling one you did not register: `surface Q106 --session <own-id>`
  first.
- An answer made anywhere else reaches your inbox the moment the board
  records it. The web pages take no answers.

## The names line

Not where the mod runs (its band carries the queue). Elsewhere, once the
session has engaged the board (above), end the reply with exactly the line
`list --project <dir> --session <own-id> --names-line` prints; when it
prints nothing, write nothing, never "no open questions".

## Tasks

- Status: `open`, `in_progress` from the first dispatch, `completed`
  when it lands where its Intent says, `dropped`. A session flips it;
  what a task waits on is a "depends on" edge or a gate, never a status.
- `task update T-13 --status in_progress --session <own-id>` (the mod's
  `task_update` tool): `--agent "<job name>"` tags the agent and starts
  it, `--reason "..."` starts one that is not ready, `--note "..."`
  journals it, `--in-hand` takes it in hand (a session may hold
  several; one another session holds is refused naming the holder, and
  moves only with `--take-over` once the user says so, the holder told).
- `task edit T-13 --close "with T-12"` closes it when T-12 completes
  (`--close look` waits on the user's press, `--close "when <fact>"`
  names a checkable fact); `task edit T-13 --landed` reports a look
  task's work landed, so the user's band offers Close.
- `task create --json < payload.json` (`name`, `description`; usual
  `intent`, `workstream`; `track` puts it on that track). `note T-13 --body "..." --session <own-id>`
  journals a task, workstream, track or knowledge record.
- **A ruling the user makes in chat** is recorded the same turn: the mod's
  `decide` tool, else `decide --session <own-id> --json < decision.json`
  (`title`, `words` (theirs, quoted), what it governs: `tasks`, `files`,
  `commands`; `supersedes` a K-n); `decisions --task T-13` (`--track`,
  `--workstream`, `--since`) lists the ones in force.
- **Changing one once used:** `knowledge amend K-7 --body "..."` appends a
  dated clarification and keeps the number; `supersede` is for a change of mind.
- **In place only while unused:** `knowledge edit K-7` (and `task edit T-13
  --intent "..."` before its work starts) is refused once another session read it.
- **Override, the user's press:** `override request K-7 --kind fix|withdraw|scrub
  --reason "..." --summary "..." --session <own-id>`, only for a bug's text, a
  ruling never made or a secret; never wording, scope or a change of mind. A
  subagent reports to its session and never asks. Where the mod runs, ask
  with its `override_request` tool and tell the block it returns as written.
- `override unscrub K-7 --user <session>` puts a scrubbed text back within 7 days.
- `show K-7 --history` prints a record's old texts. `show` logs your read
  under the session Claude Code names in the shell; `--session <own-id>`
  where none is named.

## Tracks and handoffs

A track (`TR-n`) is a line of work in a workstream; its handoffs
(`TR-n.m`) are checkpoints. One session holds one track. Where the mod
runs, `/askerdo resume`, `/askerdo track`, `/askerdo park`, `/askerdo
handoff` and its `handoff_write` tool drive it; hand off at the 30
percent window, and before anything else past 40. Elsewhere:

- **Find:** `shelf`, `track list --workstream WS-3`, `track show TR-4`.
- **Take:** `resume TR-4 --session <own-id>` prints its kickoff; judge
  the loose files it lists first, and ask the user about each due one in
  your own reply, a proposal per file through the ask tool. A held
  one names its holder and `--take-over`, `--splinter "<name>"`,
  `--read-only`; one unseen past `tracks.quietHours` (12) reads "held,
  quiet since". **Start:** `track new --workstream WS-3 --name "..."
  --session <own-id>`.
- **Hand off:** `handoff write TR-4 --session <own-id> --json <
  handoff.json` (`focus`, `state`, `verifyFirst` per repo with a
  disposition per untracked file); the reply hands the user `/askerdo
  resume TR-4` alone in a copy block. Talk that goes on after it is
  patched in, keeping its id: `handoff update TR-4 --session <own-id>
  --json < ops.json` (the mod's `handoff_update`); once another session
  holds the track, `note TR-4 --body "..."` reaches it at its next prompt.
- **End:** `track park TR-4 --reason "..."` (`--unpark-when
  "task-completes T-13"`, `"track-ends TR-5"` or `"question-answered
  Q60"` unparks it then), `track finish TR-4 --outcome "..."`.
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
  `fork`, `agent:opus`, `agent:sonnet`), which the kickoff prints, and
  `task edit T-14 --run-by agent:opus` changes it. `edge add T-14 T-13 --reason "..."` (T-14
  waits on T-13); `track reorder T-14 --before T-13 --reason "..."` (or
  `--after`, `--position N`) moves a task in its track's order. A
  handoff's result and the kickoff name the open tasks nothing waits on
  but the longest chain's end: confirm each in the reply as an end on
  purpose, or wire it with `edge add`.
- **Inbox:** the kickoff lists every open task on no track in the
  project's open workstreams; put each on a track (`track capture
  --track TR-4 --task T-20`), move it (`task edit T-20 --workstream
  WS-5`), or ask the user.
- **Upkeep:** `upkeep --dry-run` lists what automatic upkeep would
  unpark, close, set back to open and put on the band; `upkeep on`.
- **Speed:** `timings` prints p50 and p95 per verb from this PC's local
  server and the board, and the board's last check.
- **Folders:** the board names a project only by its shared name (its
  git remote, else its main checkout's path); `projects` lists this PC's
  folder for each, learned at session start, and `projects scan
  <folder>` maps a checkout (or the checkouts in a folder) the kickoff
  says has no folder here. The listing marks an entry whose folder is
  gone or is now another project; `projects forget <name>` drops it.
