# Onboard a project

`/askerdo:onboard` moves a project's old working notes onto the board: handoff and status files, TODO lists, decision logs, CLAUDE.md rules and Claude's memory for the project. You get the project's live work as a track you can resume, its rulings as decision records and its rules as rule lines, and nothing is written until you have seen what will land.

It needs a board, which `/askerdo:configure` sets up ([Pick a board](getting-started.md#3-pick-a-board)); a PC in text mode has none to write to.

## Running it

Open a Claude Code session in the project's folder and run:

```text
/askerdo:onboard
```

Claude follows one arc, and tells you its shape before it starts:

1. **Survey** (read only): it reads the board and the project and reports what it found.
2. **Discovery**: it judges every find against the repo as it is today and settles what it can.
3. **Your calls**: only the finds it could not settle come to you, as questions on the band.
4. **Review page**: a local page with every find at Claude's proposal. You press only where you disagree, then I'm done. With no calls left, your go in chat does instead.
5. **Rehearsal**: the import runs against a scratch board first, and Claude shows you the counts.
6. **Live write**: on your go, the import goes onto the board.
7. **Handover**: Claude proposes the edits to your repo, and makes each on your OK.

Through all of it you are asked for: a few band questions at most, one press of I'm done (or a go in chat), a go after the rehearsal, and an OK for each repo edit. A project whose files all speak for themselves often asks you nothing until the go.

## What it reads

The survey writes nothing in the project. It reads:

|Source|What becomes of it|
|-|-|
|The state file (the one AGENTS.md, CLAUDE.md or a README says to read first or keep current) and other handoff files, with their git history|A track with its handoffs; the next steps become tasks on it, in order, each with what it waits on|
|Checkbox lists|Tasks, or a track when a list is a line of work|
|Decision logs, split by entry heading, entry id, bullet or table row|Decision records|
|CLAUDE.md and AGENTS.md bullets|Rule lines on a profile for the project|
|Claude's memory files for the project|Feedback as rule lines, references as knowledge records, a note about you as a question of whose profile it goes on|
|Step lists and `docs/procedures` files|Procedure cards|
|An old `.claude/questions` queue|Questions; one that repeats a decision-log entry is left out, the entry kept as the ruling|
|Git history: the newest 3000 commits, subjects and file paths only|Rulings told only in commit messages and deleted planning files come to Claude as evidence or calls; the project's arc becomes one knowledge record|
|What the board already holds for the project|An earlier import's records drop out, so a rerun proposes only what is new|

TODO comments in code stay in the code. Each find carries where it came from (file and line, or commit) and its date from the old system, and the record it becomes keeps that line in its text.

What the import cannot carry, and how Claude covers it:

- A rule over 400 characters: Claude shortens it to one line in its own words.
- The order of an ordered list: Claude gives each task what it waits on and who runs it.
- Work in flight that only the state file names: Claude turns its next steps into tasks.

## The review page

Claude starts the page on this PC (`http://127.0.0.1:8767` unless that port is busy) and gives you the link. It shows only the page and saves only the marks from the page it served.

- **Your calls** sit at the top: the rows Claude could not settle, each needing your mark.
- Every other row is already at Claude's proposal, folded by group with the starting marks in the group's line. Open a group only to disagree.
- Each row takes **Keep** (import it as proposed), **Convert** (import it differently: say how in the note) or **Leave** (do not import it). A group has Keep all, Leave all and As proposed.
- The page saves as you go. **Show only what I changed** filters to your own marks.
- Press **I'm done** and tell Claude. If the page says its server stopped, press **Copy my choices** and paste them into the chat.

With no calls left, the page is only there if you want to look: say go in chat and Claude carries on.

## What changes on the board

Each record the import writes carries the label `import:<project>` and a ref to the find it came from, so it can be found and taken back:

- a workstream for the project (or the one already holding it), with a track per old handoff file and their handoffs;
- tasks on those tracks, laid out so the ready set follows the old order;
- decision records, knowledge records and questions;
- rule lines on a profile named for the project, held on the project. If that name is taken, Claude picks a free one and tells you which.

The write pauses this PC's notifications while it runs (at most an hour) and lifts the pause when it ends. If the lift fails, Claude tells you; use Resume now on the tray menu or the notifications page.

When the write is done, the import's track waits on the shelf for you to resume (`/askerdo resume`), unless Claude takes it in hand because agents still run work on it.

## What changes in your repo

Nothing changes until the handover, and then each edit waits for your OK. Claude proposes them as one list and commits the ones you accept with explicit paths:

|File|Becomes|
|-|-|
|The state file and old handoff files|Short pointers to their track on the board, with the resume command. The old text stays in git history. Hazards and running checks in the state file move somewhere durable first (CLAUDE.md, a knowledge record or a procedure card).|
|CLAUDE.md|Lines that send a session to the old files are reworded to point at the board. Lines you asked to keep on the page stay as they are.|
|The decision log|Frozen, with a line at the top saying new rulings go on the board.|
|An old session-start or handoff checklist|Rewritten for the board's own commands, or retired where the board does the job.|
|Step lists|Moved into `docs/procedures/<name>.md` and scanned into procedure cards.|
|Claude's memory folder for the project|Renamed aside to `memory.retired-<date>` on your yes, never deleted.|

## Undo

Every id the import wrote is kept in a manifest on this PC (`manifest.json` in the onboarding's work folder, under the plugin's data folder in `onboard/<project>`), in order, with the call that takes it back. Ask Claude to undo the onboarding: it prints the undo first, then runs it on your word. It walks the manifest backwards, the last import only unless you ask for every one.

|Record|What the undo does|
|-|-|
|Tasks and tracks|Removed: a dropped track takes its handoffs, and edges go with their tasks|
|Questions and rule lines|Removed; the profile comes off the project first|
|The workstream it made|Closed|
|Decision records|Each gets a withdraw request, which you Allow or Keep on its card|
|Knowledge records|Stay, and the undo says so: no command removes one|
|A finished track|Stays finished with its handoffs; its tasks are dropped|
|A profile's last rule line, and procedure cards|Stay: a profile has to set something, and cards follow their `docs/procedures` files|

The undo touches only the board. Repo edits from the handover are ordinary commits: revert them with git.

A rerun on the same PC proposes only what is new. From another PC, the survey finds what an import wrote by the refs on its records.

## Related

- [Concepts](concepts.md): what workstreams, tracks, handoffs, decisions, knowledge and rule lines are.
- [Settings and rules](settings-and-rules.md): profiles and rule lines, where the import puts the project's rules.
- The reference Claude reads for the run: `skills/onboard/SKILL.md` and the procedure card `docs/procedures/onboard-a-project.md`.
