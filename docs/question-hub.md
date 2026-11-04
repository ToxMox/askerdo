# The question hub: the board, the CLI, and questions

The routine calls are in [askerdo-quick.md](askerdo-quick.md), the
quick reference a session reads at its first hub touch (the first
registration, or the first names line composed from the board); read
this file only for what that page does not cover. This file is the
operational spec for queue mode `hub`; the contract carries only the
behavioral rule, and queue mode `text` follows `question-file.md`
instead. The work kinds beside questions are in
[work-system.md](work-system.md).

## Where the board lives

THE BOARD IS AskerDo's OWN SERVER on a host the user picks (this PC, a
Docker host, or a home server such as Unraid), reached over the home
network, one for every machine (Q90 90c). It is one Node process in one
container or one local process; on Unraid an app in the Docker tab (Q127
127a: container `AskerDo`, port 17480, built on the server from a
`server/` copy by `bash server/unraid/install.sh <tag>`, which also writes
the app's template). It alone opens its one SQLite file, on a pool path
such as `<appdata>/askerdo` and never through a network or FUSE share.
Backups and the weekly export go to their own folder, `<backups>/askerdo`
(Q128 128c). Every
verb runs in one transaction and writes one activity row per change,
numbered in sequence; the board alone issues labels. Nothing in it runs
on a clock: date-snooze wakes and stalls are worked out when read.
Unraid's scheduler runs the upkeep through the running server, so only
the server opens the file:

```bash
docker exec AskerDo node /app/server/cli.mjs backup                   # nightly: a dated copy, 30 kept
docker exec AskerDo node /app/server/cli.mjs export /backups/export   # weekly: every record as markdown
docker exec AskerDo node /app/server/cli.mjs check                    # weekly: the integrity check
docker exec AskerDo node /app/server/cli.mjs token new <device>       # the fallback: a device token, for the first PC
```

One token is live per device: a new one revokes the old and signs that
device's browsers out and kills its live join code (`token list`,
`token revoke <device>`). A PC and a
board on different protocol versions get a plain message naming the side
to update, never strange behavior. A staging board runs beside the real
one as its own app, `AskerDo-staging`, on its own folder and port
(`install.sh --staging`).

EACH PC RUNS A LOCAL SERVER (`hooks/board-server.mjs`). It holds one
event stream to the board, resumed by sequence from its saved cursor, and
a cache of the working set, and it serves the CLI, the mod and the tray
on localhost. From the stream it writes each session's inbox lines (one
per row, by its sequence, so a replay never repeats or drops one) and
raises the alerts. Every write goes to the board at once; when the board
cannot be reached, reads come from the cache and say so, and writes fail
plainly with nothing queued.

Setting a PC up: a PC already on the board mints a join code (`join-code`,
or the tray's Add a PC), which works once, within ten minutes, and the new
PC's `/askerdo:configure` joins with it (`join <board url> <code>` under the
hood): the board trades the code for the new PC's own token, and the join
saves `boardUrl` (`http://<server>:17480`), `boardToken` and `queue: hub`
in the AskerDo config, `<data>/config.json`. A code minted without
`--device` never takes a name already on the board, so a join cannot cut
off a PC that is on it; only a code minted with `join-code --device <name>`
replaces that device's token (a rejoin). `docs/procedures/join-a-pc.md`
walks a fresh Windows PC through it. The first PC, or one with no other PC
to mint a code, gets its token from `token new` on the box above and saves
it with `join <board url> --token <token>`, whose `--seed` puts that PC's
options on a board holding none. `ASKERDO_BOARD_URL` and `ASKERDO_BOARD_TOKEN` override them; besides
`http(s)://`, the URL may be `file:<db>` or `memory:`, which run the verbs
in this process for tests and rigs. A PC with no board URL set reaches no
board.

`~/.claude/askerdo/` on each PC holds no records:

```text
~/.claude/askerdo/
  cli.mjs        the launcher the SessionStart sync keeps current
  board/         the local server: local.json (its localhost route), cursor.json (its place in
                 the stream), sessions.json, secret and port, notify.json, recent.json,
                 tray.json, timings-local.log
  inbox/         the lines waiting for each session
  log            the fail-open log
```

Every interaction goes through the launcher:

```bash
node ~/.claude/askerdo/cli.mjs <verb> [args] [--json]
```

It makes one call to this PC's local server, which runs the command; with
no local server it runs the command in this process, straight to the
board. Exit 0 success; 1 bad input, a board refusal, or a board that
could not be reached; 2 a failure in the CLI or the local server.
`--json` works on every verb. A message that a write may have run means
read before trying again: a write that left this PC and got no answer is
never sent again on its own.

**A rig** (a sandbox, a test or a rehearsal) sets three seams PER
COMMAND, never exported for a shell that will start Claude Code: the
store root, a scratch home (so the data directory and its config are the
scratch's), and a board of its own:

```bash
ASKERDO_ROOT="$RIG/root" ASKERDO_SANDBOX_HOME="$RIG/home" ASKERDO_BOARD_URL="file:$RIG/board.db" \
  node <checkout>/bin/askerdo.mjs list --json
```

A rig never runs the `board` verb or the SessionStart ensure against its
root: both refuse a root that is not the live one.

THE BOARD'S WEB PAGES read the board, and one writes it: `/` the
overview (each workstream as a card), `/ws/<label>` a workstream's drawn
graph of tracks, `/r/<label>` any record by its label or key (a track's
page carries now, the ready set, the rest in dependency order and its
handoffs; `?at=YYYY-MM-DD` names the holder of a reused label on that
day), `/needs-you` (with `?repo=<shared name>` for one project),
`/activity` (every change as a numbered row, `?ws=WS-n` for one
workstream, `?before=` for older rows), `/rulings` (answered questions,
decisions and knowledge grouped by workstream or project, `?kind=`,
`?ws=`, `?project=`), `/override/<n>` (an override request's full before
and after; Allow or Keep is pressed in the app, not here) and
`/search?q=` (a label typed there opens its page). `/settings` is the
one that writes: the same settings and rule lines as the pane's Settings
tab, saved through the settings verbs from the device this browser
signed in through, and only from a form the board itself served.
Nothing is answered there. `askerdo login` opens a single-use link (5
minutes, once) that signs this browser in for 90 days; `login --print`
prints one for the phone, and `--next <page>` names where it lands.

THE LOCAL SERVER'S ROUTE is `http://askerdo.localhost:<port>/<secret>/`,
minted once per PC. It SENDS OLD LINKS ON: its root, `needs-you`,
`q/<id>`, `w/<id>` and `r/<key>` open the board's page for the same
thing, signed in through a one-time link (a click waits 3 s at most for
it, then opens the page itself). It OPENS FILES a record lists
(`f/<id>/<n>`, with `raw` and `open`), FEEDS THE TRAY (the event stream,
the alerts, the activity pages) and serves the notifications page.

THE LOCAL SERVER IS STARTED BY A PER-USER SCHEDULED TASK, never by the
session that noticed it was down (Q111 = a): a server started from
inside a Claude session inherits Claude's Windows job, which kept an old
package alive through an update. The task is `AskerDo board`: yours
alone, registered with no admin, run under your interactive token at
least privilege, AT LOGON and ON DEMAND. Its action is the running
release's tray exe with `--serve` and this PC's AskerDo folder, a windowless
launcher that creates the node server and exits. The SessionStart sync
and the `board` verb read the registered action back and register it
again only when it is missing or stale, so each release re-points it.
Nothing stands behind it (Q94 = 2a): a task that cannot be registered or
run is one plain message, and the `board` verb exits 2 on it. When the
server did not come up at logon, `schtasks /query /tn "AskerDo board" /fo
list /v` says why: Status `Ready` while it runs, Last Result `0` for a
server created, `2` for an exe that refused its arguments. `schtasks
/end` does not stop it; the tray's Exit does, or a newer server taking
the port. At a release the `board` verb stops the old instance first,
then registers and runs the new action, a gap of a few seconds at most.
Undoing it is one step, `schtasks /delete /tn "AskerDo board" /f`, which
leaves the board and every link untouched.

Questions and answers never expire: a question stays on the board until
it is answered or dropped, however long a project sleeps, and an
answered one keeps its Answer forever.

## Timestamps

Every stamp the board writes, `created` and the close date `answered`
among them, is a FULL LOCAL TIME in the board's zone (the user's) with its
offset, to the second: `2026-09-04T13:02:45+00:00`. Local, so it reads as
the clock the user was showing; offset-bearing, so it still means the same
instant six months later. Never a `Z`, never fractional seconds.

The first ten characters are the day, and every reader accepts the older
DATE-ONLY form too (`2026-09-04`), which is what questions registered
before this format carry. A date-only stamp is read as that day, sorts at
its local midnight, and no verb ever rewrites it. `show` and `list` hand
back the raw string the record holds, in whichever form it holds it, so
take the first ten characters when you want the day and parse the whole
string when you want the instant.

A snooze's `--until` stays a bare `YYYY-MM-DD` and always will: it is a
day you name rather than a moment that happened, and the auto-wake
compares it as a day.

## IDs are labels

Every record has a hidden key (`k7m2q9xa`: links and references) and a
label in the familiar shape (`Q101`), issued by the board at
registration. Q101 names the same question in every session, on every
machine and on the board while the question is live: open, or closed
under 14 days. After that the label rests 30 days and may then go to a
new record, lowest first. Only the board issues labels, so two machines
never pick one. Never mint an ID yourself.

Any cited ID resolves with `resolve Q101` (the live holder and every
earlier holder by name and days held) or `resolve Q101 --at <day>` (the
record that held it then; a full stamp works too). A day before the id
cutover resolves through the board's map of the labels of that time.
Answer tokens keep their shape: `101b` is the live Q101's option b.

## Registration happens at ask time

A question registers BEFORE its first telling, while the asking session
still has the context, so the hub ID appears in the reply from the start
and everything renders later with no model in the loop. Where the mod
runs, its `ask` tool registers (it fills the session, the project and
the workstream). Elsewhere pipe the payload as JSON on stdin (write it to
a temp file and redirect when shell quoting gets awkward):

```bash
node ~/.claude/askerdo/cli.mjs register --json < payload.json
```

A plain session, one not yet engaged with the board (Q102 102a, Q104
104a), keeps its questions with itself. A session engages only through
the user's own acts (an `/askerdo` command, a board id typed in a
prompt, acting on a board item) or a kickoff that hands it an id; its
own question never engages it. Until then the `ask` tool registers
nothing: the mod keeps the question under a local label, `L1` counting
from 1 in that session, answered by `L1a`, `L1b` from the band, the
card or `/askerdo L1a`, where the mod records the answer itself with no
CLI call; a token typed in a prompt goes to the session, which records
it with the mod's `answer` tool. The mod refuses a CLI `register`
from such a session and points at `ask`. When the session engages, each
local question is registered with its saved payload (an answered one is
then answered with its pick and note) and its new label is told once
("L1 is now Q108 on the board"). One left unanswered when the session
closes is gone. Every session gets the rules in force on its prompt and
its agents on each dispatch; the mod's section of the contract arrives
only once the session engages.

Payload fields, required first: `name` (short human hook), `ask` (one
plain question ending in `?` naming the options inline by letter with
the pick marked, "(a, my pick)", "(b)": the card's head; the hub adds the
question number at registration, so the stored ask names the options
with their tokens, "(25a, my pick)", "(25b)"; the CLI refuses a register
without it), `gist` (why it came up), `projectDir` (the working
directory; the CLI turns it into the project's shared name, `projectRepo`,
and the board keeps only the name, Q89 89a), `session` (this session's id, read from the scratchpad path
the harness announces), `blocking` (boolean). Optional: `workstream`
(`WS-n`), `track` (`TR-n`; an old `P-n` or `TH-n` names the track it
became, and a `plan` or `thread` field is refused), `gates` (array of
`T-n`: the tasks this question gates),
`topic` (a grouping label), `pick` (the recommended option, named by
its letter or by its composed token; a pick told in the reply is ALWAYS
registered here, and `"pick": null` says there is none on purpose),
`project` (display name, defaults to the main checkout's basename), `asked`
(0 or 1, default 1; 0 for a registration not yet told),
`stakes`, `whileThisWaits`, `context` (free text), `crux` (one line: the
fact that decides it), `options` (array of `{type, option, getsYou,
costsYou}` objects, each optionally carrying `headline`, `whyPick`,
`whyNot` and `undo`), `evidence` (array of strings), `labels` and
`refs` (arrays of strings, set here only: an import's label and row
ref), `mission`, `revisits`, `cites` and `reversal` (below). Capture everything at ask
time: the question card, the reply's decision table (written in full on
every surface; on the desktop the mod hides it under the card) and the
question's page on the board all render from this one payload, and
nothing rich is ever reconstructed later.

EVERY QUESTION HAS A WORKSTREAM (T-215, 2026-10-09).
A payload with no `track` is filed on the track the session holds,
unless it names a workstream other than that track's. When the payload
names no workstream, `register` inherits it, in order, from the
question's track, the session's in_progress tasks, and the workstreams
the session is subscribed to. Several workstreams at the
first step that finds any is a refusal (exit 1) naming them: put
`workstream` in the payload. None at all files the question in the
project's inbox workstream (`<project>: inbox`, label `inbox`, minted on
first use). The board stores `pc` beside `session`: the asking PC's
name as the board knows the caller's device, left out when unknown. A
question belongs to the session holding its track (else its asker), so
a session that resumes the track owns it and hears its answer (K-726).
Each inheritance is one warning line, as is a payload with
lettered options and no pick; fix a missing pick with `question edit
<id> --pick <letter>`, never by re-registering.

THE DECISION TABLE (T-304, 2026-10-20). An option's
`getsYou` is drawn as "what happens" (what picking it does) and
`costsYou` as "catch" (the price, which may be an empty string; "one-way"
when it is hard to undo). Four optional slots, each one short line, fold
out under the option's row, drawn only when filled and always in this
order: `headline` (one plain sentence that must not restate the row; a
headline equal to its own row's what happens or catch registers with a
warning), `whyPick` (why pick it), `whyNot` (why not) and `undo` (free
text, by convention "easy", "painful" or "one-way" plus a few words).
`crux` is drawn under the gist. `show --json` and `list --json` return
every option as `{type, option, getsYou, costsYou}` plus each slot that
was filled, and `crux` at the question's top level when set; an absent
field is omitted, never an empty string. A question registered without
them reads and renders as before.

RULINGS (T-6, the what-happened guard). An answered question is a ruling.

- `revisits` (array of `Q-n`): the rulings this question reopens; each must be answered, else refused.
- `reversal` (text): required with `revisits` and refused without it: what changed since the ruling.
- The board writes `## Reverses` in the same transaction, frozen: each ruling's label and name, its Answer's first paragraph verbatim, and each option it did not choose with its catch; the reversal goes in `## Reversal`.
- A question with `revisits` is stored `blocking: true` (a warning says so when the payload said false).
- Told alone: when the same session registered another question within 60 seconds and either carries `revisits`, the board still registers it and returns `beside` (the other labels) with a warning; the mod's `ask` tool flags the same within one turn on both cards and in the turn-end note, and never refuses it (Q32, 32a).
- `cites` (array of `Q-n`): rulings mentioned as context only. A `Q-n` label of an answered question in the ask, crux, gist, stakes or option text that is in neither list is refused; answer tokens are not checked.
- `register --json` returns `revisits`, `reverses` (each ruling as `{id, name, quote, declined}`), `cites` and `beside` when set; `list --json` and `show --json` add `reversal`.

THE ANSWER TOKEN (T-79, Q99 = a). An option's stored `type` is ONE lowercase letter,
a to z, unique within the question. The token a reader sees and types is
the question's own number followed by that letter, one word: Q106's
option `b` is `106b`. The letter is what the record keeps and the number
is composed at every render, so a token always names its question. A
type that is not a single letter is refused at registration by name (the
old reply-ordinal form, `1a`, most of all), a letter used twice is
refused too, and an empty type stays legal for an option that is a plain
panel with nothing to answer. `pick` names one of the payload's own
options in either form and is stored as the letter. Questions registered
before the cut keep their stored types and show them exactly as they
were written.

Example payload:

```json
{
  "name": "store shape",
  "ask": "Should the store keep one file (a) or a file per question (b, my pick)?",
  "gist": "Decides edit safety and what a session must read at start.",
  "projectDir": "C:/repos/my-app",
  "session": "<session-id>",
  "blocking": true,
  "workstream": "WS-4",
  "pick": "b",
  "crux": "Do two sessions ever edit the same question at once?",
  "stakes": "Locks the on-disk layout every later feature reads.",
  "whileThisWaits": "The store design stays open and dependent work is blocked.",
  "options": [
    {"type": "a", "option": "single file", "getsYou": "simplest possible store", "costsYou": "every edit touches everything"},
    {"type": "b", "option": "file per question", "getsYou": "isolated edits, filesystem as index", "costsYou": "more files to manage", "headline": "No edit can clobber another question.", "undo": "painful, a migration"}
  ]
}
```

`register --json` returns `{id, key, name}`, plus `workstream`, `track`,
`gates` and the ruling fields when set, `warnings` (the lines above) when there
are any, and `boardUrl`, the question's page on the board, when the
board serves pages. Use the returned `id` in the reply and the returned
`boardUrl` for the links; never assemble a board URL by hand. The
returned `id` is also what the tokens compose from: registered as Q106,
the two options above are `106a` and `106b` wherever they are shown,
typed or pasted.

## The verbs

| Verb | Does | Flags |
|-|-|-|
| `register` | issue a label and write the question; the registering session is its first subscriber | payload on stdin |
| `answer <id>` | fill the Answer section, whose head carries the composed token, flip status, tell every subscriber but the caller | `--pick <token>` takes the composed token `106b`, the bare letter `b`, or, for a question registered before the cut, its stored type, and records the stored letter; a composed token whose number names another question is refused. `--note "why"`, `--session <own-id>`. `--user <session-id>` records the user's own chip press in that session (T-28): the actor is `user:<id>`, so no subscriber is skipped and that session hears it too. `--amend` CORRECTS an answered question instead of refusing it (Answering, below) |
| `drop <id>` | record the decline, flip status, the same telling | `--note`, `--session`, `--user` |
| `snooze <id>` | defer visibility with a wake condition | AT LEAST ONE of `--until YYYY-MM-DD`, `--trigger "text"` and `--wake-on <ref>[:<status>]` (Snoozing, below); any two or three combine and whichever fires first wakes it. `--user` |
| `wake <id>` | snoozed back to open | |
| `question edit <id>` | move a question to another workstream or track, set or fix its recommended pick while it is open or snoozed (T-260), and name the tasks it gates (T-216). Its status, its name and its prose are NOT here: they have their own verbs | `--workstream WS-n`, `--clear-workstream`, `--track TR-n` (an old `P-n` or `TH-n` names the track it became), `--clear-track`, `--pick <letter>`, `--clear-pick`, `--add-gate T-n`, `--remove-gate T-n` (both repeatable), `--session <own-id>` |
| `surface <id>` | bump `asked`, print the payload, subscribe the calling session | `--session <own-id>` |
| `subscribe <id>` | subscribe a session to a question (work is followed through a track or the task in hand) | `--session <own-id>` |
| `list` | the open set, blockers first then oldest, one head line each and a last line naming what it left out; `--json` is `{questions, openSetUrl, localUrl, recentUrl, shelfUrl, board}` (`board` the blocking and waiting counts), plus `inHand` with `--session` (every task the session has in hand, newest first) | `--open` (default), `--all`, `--snoozed`, `--project <dir>`, `--session <id>`, `--blocking`, `--workstream`, `--track TR-n`, `--names-line` (below) |
| `show <id>` | one record at a read level: the brief form by default, which is NOT the full record (work-system.md, Listing and showing) | `--head`, `--section <name>`, `--journal`, `--journal-tail N`, `--since-resume`, `--full`; `--json` alone is the whole record |
| `resolve <label>` | the record a label names now and every earlier holder | `--at <day>` |
| `activity` | the board's activity log, newest first (below) | `--limit`, `--before`, `--month`, `--id`, `--kind`, `--search`, `--project`, `--places` |
| `search <words>` | the board's search, each hit's head and the lines that matched (below) | `--tab questions\|work\|both`, `--ws WS-n`, `--limit <n>` |
| `board` | start this PC's local server through its scheduled task, or adopt the one already answering, and print its URL | |
| `login` | open a single-use login link to the board's web pages | `--print`, `--next <page>` |
| `join-code` | mint a code that lets one new PC onto the board, once, within ten minutes, and print the board address, the code and a line the new PC can run; minting another replaces it, and so does a new token for this PC. A code without `--device` never takes a name already on the board | `--device <name>`: the only name the code takes, and the one way to rejoin (replace) a device already on the board; `--json` |
| `join <board url> <code>` | put this PC on the board with a join code: saves `boardUrl`, this PC's own `boardToken` and `queue: hub` in the AskerDo config, keeping every other option, and prints no token; it runs with no board set | `--device <name>` (default: the host name), `--json` |
| `help [verb]` | every verb on a line, or one verb's flags and stdin; `<verb> --help` is the same | |

## The activity log

Every verb that changes a record writes ONE row per change in the
board's activity table, inside the same transaction as the change, so a
row and its record can never come apart. A row's sequence number is its
place in the event stream, the cursor each PC resumes from, and the page
cursor. The line carries the time, the verb, the record's kind, id, key
and name, the fields that moved as `field: [from, to]`, who made it
(`session:<id>`, `user:<session>` for the user's own chip press, `cli` for a bare CLI
call; lines imported from before the board keep `github` and `board`)
and, where the verb carried one, a short excerpt of its note; the PC
rides in the row beside the line. Nothing is ever edited or deleted.

```bash
node ~/.claude/askerdo/cli.mjs activity                      # the last 50 changes
node ~/.claude/askerdo/cli.mjs activity --month 2026-08      # one month
node ~/.claude/askerdo/cli.mjs activity --search "ordinal"   # every line holding the text
node ~/.claude/askerdo/cli.mjs activity --id T-13 --json     # one record's lines, by its key
node ~/.claude/askerdo/cli.mjs activity --before 412         # the page after
```

`--limit` is 50 by default and 0 for every line. `--before` takes the
sequence a page printed (`next page: --before <n>`, `nextBefore` in
`--json`) or a full stamp. `--id` follows the record's key, so a reused
label's earlier lines stay out. `--project <dir>` keeps the lines of the
workstreams that name the project and of records asked from it;
`--places` adds each line's workstream and project. `--json` is `{lines,
nextBefore}`, each line's `at` its sequence. The tray's console and the
pane's Home read the same rows through the local server.

THE SEARCH is the board's full-text index (FTS5, the `unicode61` word
splitter) over every record's title and body, its journal notes and
answer paragraphs, and every handoff's focus, state and where we were,
kept current by the database itself. A READ: nothing is touched. Every
word of the query must match as a whole word, case aside; hits come best
match first. Each hit prints its record's head line and up to three of
its lines that hold a query word, each cut at 200 characters, and a last
line saying the records themselves were not shown. `--tab questions`,
`work` or `both` (the default), `--ws WS-n` keeps one workstream, and
`--limit` is 20 by default, 50 at most. `--json` is `{text, hits, total}`,
each hit `{id, key, kind, name, status, lines}`. The activity log is not
searched here: `activity --search` reads it.

```bash
node ~/.claude/askerdo/cli.mjs search "activity log"          # both words, anywhere in a record
node ~/.claude/askerdo/cli.mjs search board --ws WS-4         # narrowed to one workstream
node ~/.claude/askerdo/cli.mjs search board --tab questions --limit 5 --json
```

## The names line links the board

When at least one question in this session's scope is open, end every
substantive reply with the names line. When none is, write nothing
about questions at all: no zero count, no remark that the queue is
empty. Copy the line rather than composing it: `list --names-line
--project <projectDir> --session <own-id>` prints it exactly, and prints
nothing at all when the session's scope holds no open question. Its shape:

```markdown
❓ **[5 open questions](<Needs you page>)**: [Q101 store shape](<question page>) · [Q104 port pick](<question page>) · [Q107 icon set](<question page>) and [2 more](<Needs you page>)
```

The bolded count opens the board's Needs you page for the project; each
name opens its question's page on the board; "and [N more]" appears only
past three. Scope (T-246, 2026-10-09): only a session
that has engaged the board writes the line at all (the user's own act:
an `/askerdo` command, a board id typed in a prompt, acting on a board
item; or a kickoff that hands it an id; its own question never engages
it, Q104 104a), and it names the OPEN questions of the track the session
holds (with no track, the ones it registered; a resumed track's session
takes its questions over, K-726) and the ones it surfaced, blockers
first then oldest. The line neither names nor counts any other open
question, a blocker on another track in the same workstream included: a
session learns of a question it does not own only through the AskerDo
mark and its hover (K-728), and a session that owns none prints nothing.
`--names-line` with `--session` prints that scoped line, `--blocking`
its blockers alone, and without `--session` it names
the whole project. Where the AskerDo mod runs, its band carries the queue and no
reply writes the line. Snoozed questions stay off the line until woken.

The links come from the CLI, never built by hand: `boardUrl` on
`register`, `show` and each `list --json` row, and `openSetUrl` on `list
--json`. The local server's shape, for recognition only, is
`http://askerdo.localhost:<port>/<secret>/...`; its old links still land
on the board's pages.

## Alerts, the tray and the notifications page

Every alert is a card in the native tray exe's own popup by the tray
corner (`askerdo-tray.exe`, which the server spawns; K-725), in every
state: at the desk, presenting, full screen, away or in quiet time. The
local server raises one from the board's rows as they arrive: a question
opened, closed or woken, and a task completed or dropped or a workstream
closed by a session (the ending alerts, work-system.md). A question's
card leads with its name; the line under it names what woke it for a
woken question (`woken by <name of the ended record>, completed`, or
`woken by its snooze date`), then the project, the
workstream and the task it holds up where they are known (else its id,
state and workstream, `Q85, blocks work, WS-4 widget-panel`), then its
pick, a link that opens its page on the board (`r/<id>`) and one that
opens its files. A blocking question's card stays until dismissed; the
rest leave after a few seconds unless the pointer is over them. The work
endings name the record and the ending; the collapse summary names how
many more changes came and links the board.

`board/notify.json` holds the settings, one row per alert shape
(`blocking`, `open`, `closed`, `woken`, `task-completed`,
`task-dropped`, `plan-closed` (which a workstream's close reads),
`collapse`), each with `show` and a `sound` (one of the twenty-five
Windows names, or `silent`), all shown with the default sound by
default. A file written by an older build may carry a `duration` on a
row; it loads and is ignored. Beside the rows:
QUIET HOURS (`quietFrom`, `quietTo`, `HH:MM`; empty is off, a window may
cross midnight, equal ends are off), the PAUSE (`pausedUntil`: `''`, a
stamp, or `until-resume`, set only through the `pause` verb on the
notifications route, which takes `hour`, `tomorrow` for 07:00 the next
day, `until-resume`, or `''` to resume, and refuses `pausedUntil` by
name), `enabled` (the whole channel off, no tray process), `tray`
(`false` hides the icon and leaves alerts flowing), and `editor`, the one
editor a file ref opens in (two templates, `file` and `folder`, a scheme
URL or a command line each, with `{path}`, `{line}` and `{col}`; the
server never runs it, it hands the tray exe a program and arguments).
Neither switch refuses an open a person asked for. The files an opener
opened are kept in `board/recent.json` (twenty, files only), and
`board/tray.json` records the running tray.

THE TRAY MENU is rebuilt on every right click: a counts line (`3
blocking, 6 waiting`, `nothing waiting`, or `connecting`), the blocking
questions by name (up to five, oldest first) and the newest waiting
ones, each opening its page on the board; the recent files, each asking
the server to open that ref by record and position; `Open board`;
`Activity`; `Add a PC`, a page of the local server (`<secret>/add-pc`)
whose Mint a code mints a join code through the board with this PC's
token and shows it, its expiry, the board address and a line the new PC
can run, with a copy button (loading the page mints nothing, so a reload
never kills a code already typed on the new PC);
`Notification settings`; `Pause notifications` with `For 1 hour`,
`Until 07:00 tomorrow`, `Until I resume` and `Resume now`; and `Exit`.
The tooltip says the blocking count. A tray that is absent or will not
attach is no tray at all (Q94 = 2a): an alert that finds none is logged
and dropped. The tray's Start Menu entry, `AskerDo.lnk`, opens the board;
the exe's own `--unregister` removes it.

THE NOTIFICATIONS PAGE, at `<secret>/notifications` and in the tray
menu, changes every one of those settings: the master switch, the pause
block, the quiet hours, the eight rows (show, sound with a play arrow,
and a Test button that draws the row's card) and the Openers section. A
change is one POST of one value and the control repaints from what came
back. Test and the play arrow write nothing and pass no gate. No restart
is needed: the server re-reads the file every tick. These settings are
the only gates: Windows' notification switches and do-not-disturb do not
hold back the popup.

## Refresh before telling

Before composing the first names line of any turn that touches the
queue, refresh:

```bash
node ~/.claude/askerdo/cli.mjs list --project <projectDir> --session <own-id> --names-line
```

Scoping keys on the project's shared name (Q89 89a): its git remote
(Q514), else its main checkout's path, normalized (a worktree is its main
checkout's project), so one repo checked out at two paths on two
machines is one project and two repos sharing a basename never merge;
the short project name is display only. Never re-tell a question the
board says is closed. A `list`, a question `show` or a `surface` wakes
the date snoozes whose day has passed. During long autonomous work
without the mod, re-check the same way between work items: an answer
given mid-flight reaches the work at its next checkpoint instead of
waiting for the next prompt.

Telling a question this session did not register (or re-telling one
after a real gap) goes through `surface <id> --session <own-id>` first:
it bumps `asked` and subscribes this session, so a later answer from
anywhere reaches this session too.

## Typing q

On "q", pull the open set (`list --project <projectDir> --json`) and
print it as typed decision tables: one block per question, the question
line first, then its crux, then its options as a
`| type | option | what happens | catch |` table whose type cell carries
the composed answer token, the question's number and the option's letter
(`106a`, `106b`), one token that names its question wherever it is read
or typed, the recommended token starred (`106b *`), then the next
question, and the open-set link (the Needs you page) at the end. Then
ONE trailing line for what is asleep, read from `list --project
<projectDir> --snoozed --json`: each snoozed question and what it waits
on (a date, a trigger, or the record a linked wake names), and nothing at
all when none is asleep. No widgets, no panels: reply text only.
Declining stays typed ("drop Q104"); there are no dismiss controls in
reply text.

## Gated tasks

A question that gates a task names it in `gates` (T-216). `show` on the
question names its gates, and while the question is open or snoozed a
gated task names it as what it waits on ("after Q93"), which keeps it
out of its track's ready set. Answering or dropping the question appends a journal paragraph to
each gated task saying how it ended. Registering a blocker that gates a
task tells the session that has the task in hand and the one holding its
track.

## Answering

One write path: every answer, wherever it happens, lands on the board
through the `answer` verb.

- Typed in chat: record each token at once (`101b 102a` is two
  answers), through the mod's `answer` tool where it runs (the only way
  to answer a local label), else with
  `answer Q101 --pick 101b --note "why" --session <own-id>` (either flag
  alone is fine; `--session` keeps this session out of the telling,
  since it just saw the answer). `--pick` takes the composed token
  (`101b`), the bare letter (`b`) or, for a question registered before
  the cut, its stored type, and records the stored letter whichever was
  typed; a composed token whose number names another question is refused
  in words rather than filed as free text. `drop Q104 --session
  <own-id>` declines the same way. A durable project decision is also
  recorded on the board as a decision record through `decide` (the
  tool, else the CLI verb) with the user's words quoted and what it
  governs; Claude's auto memory is never its home.
- Anywhere else: the user's chip on the band or a card, `/askerdo 101b`,
  another session, another PC. The board records it through the same
  verb, and each PC's local server writes one line into the inbox of
  every subscribed session (the asking one and each that surfaced it),
  worded like `Q101 (store shape) was answered by the user: 101b. Why: ...`,
  with "in another session" for a session's answer; a pick-less answer
  drops the pick segment. Where the mod runs it hands the line to the
  model at the next prompt or, mid-turn, at the next step; without the
  mod nothing delivers it mid-turn, so the re-checks above are the way
  in. Treat it exactly like a typed answer that arrived late. The board's
  web pages take no answers.
- Changing your mind: `answer Q101 --amend --pick 101a --note "why"
  --session <own-id>` records the new answer on a question that is
  already answered, which the verb refuses without the flag. The `##
  Answer` section then carries the CURRENT answer as its head paragraph
  and every answer it replaced beneath it, NEWEST FIRST, one paragraph
  each reading `Earlier answer, given <when it was given> and replaced
  by the answer above on <when it was replaced>: <that answer>`. Both
  dates ride in the sentence and the direction is said in words, so a
  reader of `show` or of the page knows which answer came first without
  reading anything else. The head of the section is always the answer
  that stands, which is where every reader takes the pick from, and
  nothing once recorded is overwritten. `status` stays `answered`, the
  question keeps its `answered` stamp (it ended when it was first
  answered) and bumps `updated`, one activity row (`amend`) carries both
  picks, and subscribed sessions read "Q101 (store shape) had its answer
  corrected in another session: 101a. Why: ...". It refuses an open,
  snoozed or dropped question in words, and an amendment whose pick and
  note are the ones already recorded writes nothing at all. A correction
  raises no alert: an alert fires on a question opening or closing, and
  an amendment moves neither.

A session explicitly told to wait for an answer may Monitor its own
inbox file (`~/.claude/askerdo/inbox/`) or the question (`show Q101
--head`) and resume the moment it lands. Monitoring is never
self-initiated: an idle window is just a window, and nothing watches the
board or wakes on an answer unless it was asked to.

## Snoozing

Snoozing defers VISIBILITY and resolves nothing. A snoozed question
leaves the names line and the open counts; its page on the board shows
it snoozed with what it waits on. A snooze takes AT LEAST ONE of the
three conditions below and any of them combine, whichever fires first.
It comes back four ways: a date snooze (`--until YYYY-MM-DD`, a bare day
and never a clock) wakes on the first `list`, question `show` or
`surface` once the day has passed; a trigger snooze (`--trigger "after
the beta ships"`) is passively re-shown (the `q` view's asleep line
names its trigger) and wakes via `wake Q101`, or plain words in
any session; a linked snooze (`--wake-on T-75`) wakes by itself in the
transaction that ends the record it names; and answering a snoozed
question directly is always allowed and closes it like any other.
Ignoring, snoozing, and answering stay three different things: ignoring
changes nothing, snoozing defers visibility, only answering resolves. A
deferral ruled aloud in chat ("next session handles Q101") is recorded
at once as a trigger snooze carrying that wake condition, so the board
matches the ruling rather than the raised hand dropping on memory alone.

THE LINKED WAKE is `--wake-on <ref>` or `--wake-on <ref>:<status>`,
where the ref is the record this question waits on (a task, a track, a
workstream, or another question; an old plan or thread id names the
track it became) and the optional status is one of that kind's endings. It is
stored inside the snooze beside `--until` and `--trigger`. ANY ending of
the linked record wakes the question: a task completed or dropped, a
track done, dropped or folded, a workstream closed, a question answered
or dropped. A named status is recorded and reported but never gates the
wake, because a record that was dropped can never reach the status
somebody named. The wake happens in the ENDING VERB'S OWN TRANSACTION:
the ended record, every question it woke, and one activity row for each
of them (`woken by T-75 completed`) land together, so a wake and the
ending that caused it can never come apart. Nothing polls, and no reader
wakes a link. The refusals are by name: a ref no record holds, a
question naming itself, a status that is not one of that kind's endings
(`T-75:blocked`), and a ref that has ALREADY ended, since a wake trigger
names an ending that has not happened yet. A record REOPENED later keeps
the link and wakes at its next ending.

When a linked wake fires, the question raises the same woken alert a
hand wake raises, under the same `notify.json` gates and the same burst
cap; and it tells every session subscribed to the question,
the way an answer does, as one line: `Q93 (linked wakes: which endings
wake) woke in another session: T-75 completed.` The date auto-wake tells
them the same way (Q37 37a): `Q509 (card header) woke on the board: its
snooze date came.`, an alert once and a line at each session's next
prompt, starting no turn. The hand wake stays silent to the inbox.

## When tooling fails

Fail toward the reply, never toward silence:

- The CLI missing, erroring, or refused: keep the question in-reply, in
  full, and say plainly that the board did not take it; register it
  through the CLI once the cause is fixed. A question is never silently
  lost to a tooling failure, and the same holds for answers.
- The board unreachable (the board host down, or the PC off its network):
  a read comes from this PC's cache and says so once (`the board is
  offline: this read came from this PC's cache`), the band shows the
  board offline, and every write fails plainly (exit 1) with nothing
  queued: keep the question in the reply, say so, and register it when
  the board is back. A write that may have run is read before it is
  tried again. A handoff the board could not take comes back whole in
  the tool's result, and the reply carries it in a fenced block.
- The local server down: the launcher runs each command in its own
  process, straight to the board, with no cache to fall back on. Old
  local links and an alert card's links show the browser's error page, no
  alert is raised and no inbox line is written; when the server is back
  its stream resumes from the saved cursor, so no line is lost or told
  twice. Recovery is starting any session or running the `board` verb.
  The tray goes with it: the native tray exits when its server is gone
  (its stream breaks and its ping goes unanswered twice, exit code 6),
  and an alert that finds no tray is logged and dropped. This is the only place server-down behavior is stated.

## Lifecycle

1. **Registered at ask**: full payload to `register`; the hub ID and
   board link appear in the first telling.
2. **Told**: inline, in full, exactly once; the contract's told-once
   discipline is unchanged.
3. **Surfaced**: shown again (q, a repeat telling, another session);
   `surface` bumps `asked` and subscribes the surfacing session.
4. **Closed**: `answer` or `drop` (typed, or a chip or `/askerdo` where
   the mod runs) fills the Answer section, flips status and tells the
   subscribers.
5. **Graduated**: a durable project decision is also recorded durably
   at close time: a decision record on the board through `decide`, never
   Claude's auto memory.
