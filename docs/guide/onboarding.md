# Onboard a project

`/askerdo:onboard` converts the way a project works into AskerDo. Only the old system's live state moves to the board: every rule a session still loads becomes a rule line, the work in flight a track with its handoff and tasks, rulings still in force decision records, open questions questions, facts still true knowledge records, routines still run procedure cards. Everything else the old way produced is its history (run logs, lane and state notes of finished work, briefs, reviews, archives, finished plans): it leaves the tree with its folder, and git keeps it. The project leaves with one system, and nothing is written until you have seen what will land.

It needs a board, which `/askerdo:configure` sets up ([Pick a board](getting-started.md#3-pick-a-board)); a PC in text mode has none to write to. A project the board already holds goes to [`/askerdo:doctor`](doctor.md) instead.

## Running it

Open a Claude Code session in the project's folder and run:

```text
/askerdo:onboard
```

Claude follows one arc, and tells you its shape before it starts:

1. **The facts** (read only): a survey gathers what the board holds for the project and what the repo shows, and judges none of it.
2. **The proposal**: Claude reads the facts and the files it needs, writes the conversion plan for this project, and settles every question the repo or the board can answer.
3. **Your calls**: only what Claude cannot settle comes to you, as questions on the band: which dormant plans are still wanted, as one list, and any rule that differs from a line already in force.
4. **Rehearsal**: the import runs against a scratch board first and the repo edits run on a copy of the repo. A fresh reader, an agent that never saw the plan, reads that copy as a new session would start in it and lists what of the old way is still there and any record of the wrong kind. Claude gives you a report of what will land, with that list as the check against the aim (the goal is an empty list), the rewritten CLAUDE.md whole, and one line per rule file and hook saying where it went.
5. **Your go**: one go covers the board write and every repo edit the report lists.
6. **Live write and handover**: the import goes onto the board, a coverage check reads each converted source against what it became, and Claude makes the repo edits, one commit per folder.

Through all of it you are asked for a few band questions at most and one go after the rehearsal. Say "ask me per file" at the go to OK each repo edit instead.

## What it reads

The survey writes nothing in the project. It gathers facts into its work folder (under this PC's AskerDo data folder, in `onboard/<project>`), starting where sessions start:

- **The board**: the project's workstreams, tracks, open tasks, answered questions, decisions, knowledge, rule lines in force, and what an earlier import wrote.
- **The entry points**: CLAUDE.md, AGENTS.md, `.claude/rules`, Claude's memory for the project and the README, with their text and the files they name.
- **One pass over git's history**, file paths and subjects only, and one over what is not committed yet: per folder, its files, commits, first and last touch and commit subjects, where something cites into it, and whether code or a script reads it.
- **CLAUDE.md, clause by clause.**

## The proposal and your calls

Claude reads the facts the way a person would, whatever shape the old system has, and opens what it needs to decide: the current handoff, a folder's index, a decision log, a plan whose state the history leaves unclear. It judges each folder as the old workflow's machinery or the project's own, and writes the proposal: each record to write, with where it came from and why it is live; each old workflow folder with its end and why; your calls; and each CLAUDE.md clause with where it goes. A system that works and was built with care is converted, not kept: a folder stays only with a reason of a named kind (the project's product, someone else's file, a document written for people, a tool, a capability AskerDo lacks, which Claude files), a rule scoped to some files keeps that scope as a decision or card, a superseded ruling is dropped, what the board already holds is linked rather than written again, a rule over 400 characters is shortened to one line (its whole text goes to a knowledge record the line points at), and the live handoff's next steps become tasks in order, each with what it waits on and who runs it. On a large project Claude can split the reading among helper agents by folder group.

What only you can decide comes to the band, one question each with Claude's pick marked:

- **Dormant plans**: plans with open items that nothing has touched in months and whose history does not show the work landed, listed with their open item count and last touch. A plan you still want becomes a track with its tasks; the rest go with their folder. A plan whose work later commits show landed goes with its folder without a question.
- **A rule that differs from a line in force**: which one stands. Keep the board's line, or let the project's rule replace it, so every session and brief carries one line.

## What changes on the board

Each record the import writes carries the label `import:<project>` and a ref to the item it came from, so it can be found and taken back:

- a workstream for the project (or the one already holding it), with a track for the live handoff and one per plan still worked, each with its handoff;
- tasks on those tracks, laid out so the ready set follows the old order;
- decision records, knowledge records and questions;
- rule lines on a profile named for the project, held on the project. If that name is taken, Claude picks a free one and tells you which.

The write pauses this PC's notifications while it runs, an hour at a time and renewed for as long as it runs, and lifts the pause when it ends; a pause you change meanwhile stays as you set it. If the lift fails, Claude tells you; use Resume now on the tray menu or the notifications page.

When the write is done, the import's track waits on the shelf for you to resume (`/askerdo resume`).

## What changes in your repo

Nothing changes until the handover. Your go after the rehearsal covers the edits it listed, and Claude commits them with explicit paths, telling you each commit as it lands:

|What|Becomes|
|-|-|
|Each old workflow folder|Deleted in one commit of its own once nothing of it is left: no code or data file reads it, every source converted from it is covered on the board, and no open item in it outlived your dormant-plans answer; the old text stays in git history. A folder git does not track stays, since git has no copy of it, and Claude names it. A folder code or a data file reads stays, with that reader as the reason.|
|Files that stay and cite a folder that goes|Repointed to the record or file that holds it now, or to the commit that holds the old text. A citation a tool prints that the handover cannot resolve keeps the folder it names.|
|CLAUDE.md (or the AGENTS.md Claude reads)|Rewritten: it keeps what the project is; its working rules move to the board, a clause that is both a fact and a rule keeps the fact in new words, the lines that send a session to a retired file come out, and one section at the end points at the board. The rehearsal report lists every clause and where it goes.|
|Hooks, menus and servers that loaded the old rules|Retired with what they load, their entries taken out of `.claude/settings.json` or `.mcp.json` in the same commit. A hook that enforces a rule (refuses a push, runs a formatter) stays as the project's tool, and its rule also goes to the board.|
|Step lists and routines|Written to `docs/procedures/<name>.md` and scanned into procedure cards.|
|Claude's memory folder for the project|Renamed aside to `memory.retired-<date>` on your yes, never deleted.|

## Undo

Every id the import wrote is kept in a manifest on this PC (`manifest.json` in the work folder), in order, with the call that takes it back, and it names each repo commit the handover made. Ask Claude to undo the onboarding: it prints the undo first, then runs it on your word. It walks the manifest backwards, the last import only unless you ask for every one.

|Record|What the undo does|
|-|-|
|Tasks and tracks|Removed: a dropped track takes its handoffs, and edges go with their tasks|
|Questions and rule lines|Removed; the profile comes off the project first|
|The workstream it made|Closed|
|Decision records|One withdraw request takes them all, which you Withdraw or Keep once on its card|
|Knowledge records|Stay, and the undo says so: no command removes one|
|A finished track|Stays finished with its handoffs; its tasks are dropped|
|A profile's last rule line, and procedure cards|Stay: a profile has to set something, and cards follow their `docs/procedures` files|
|The handover's repo commits|The undo prints `git revert <commit>` for each, newest first, and runs none of them without your word|

The undo touches the board and, where the project keeps an AGENTS.md, rewrites the AGENTS.override.md AskerDo writes for Codex (kept out of git) from what the board still holds. Repo edits from the handover are ordinary commits, each named in the manifest as it lands: revert them with git. If git refuses a commit, that folder is put back as it was, the handover stops and Claude tells you git's message; the commits before it stay.

## A second run

The board keeps a conversion map for each project: every source a run converted, with its content hash at that commit and the records it became; each folder's end (deleted or moved at which commit, or kept and why); each answer you gave; and each run with its commit. A second onboard or doctor run, from this PC or any other, reads the map first: Claude opens only the folders with commits since the last run, new folders and sources that changed, the plan skips every item whose source is unchanged, and a call you answered is not asked again while what it was about is unchanged. Records an earlier import wrote without the `import:` label (the label `imported` with a `handoff-import:` ref) count as imported, and the paths their refs name are on the map from the first run. The manifest on this PC is the undo's alone, and the undo takes its run's rows off the map, except a source whose records all stay (knowledge records, say), which a later run reads as unchanged.

## Related

- [Concepts](concepts.md): what workstreams, tracks, handoffs, decisions, knowledge and rule lines are.
- [Settings and rules](settings-and-rules.md): profiles and rule lines, where the import puts the project's rules.
- The reference Claude reads for the run: `skills/onboard/SKILL.md` and the procedure card `docs/procedures/onboard-a-project.md`.
