# Onboard a project

`/askerdo:onboard` converts the way a project works into AskerDo, small by default. Only what is live moves to the board: the rules a session still loads become rule lines, decisions or cards; the work in flight a track with its handoff and tasks; your rulings in force decision records in your words; the routines still in use procedure cards; and your memory feedback rule lines. What the code already tells (a port, a file's layout, what a module does) is not recorded. Everything else the old way produced is its history (run logs, state notes, findings, briefs, finished plans): it leaves the tree whole with its folder, git keeps it, and one pointer record per workstream names the commit that holds it. The project ends with one system, and nothing is written until you have seen a rehearsal of what will land.

It needs a board, which `/askerdo:configure` sets up ([Pick a board](getting-started.md#3-pick-a-board)); a PC in text mode has none to write to. A project the board already holds goes to [`/askerdo:doctor`](doctor.md) instead.

## Running it

Open a Claude Code session in the project's folder and run:

```text
/askerdo:onboard
```

Claude tells you the run's shape first, then follows one arc:

1. **The facts** (read only): a survey gathers what the board holds for the project and what the repo shows, and judges none of it.
2. **The proposal**: Claude reads the facts and the files a judgment needs, decides where each live thing goes, and puts what is alike into groups.
3. **Your calls**: each group comes to you as one question on the band, with its count, three examples and one answer for the whole group; a few choices only you can make come as questions of their own.
4. **The rehearsal**: the board write runs against a scratch board, a coverage check reads it back, and the undo runs with its one press, so you see that the undo takes back what the write made. Claude gives you the rehearsal report. Nothing touches your board or your repo.
5. **Your go**: one go covers the board write and the one commit in the repo.
6. **The live write and the handover**: the import goes onto the board, coverage reads each converted source against what it became, and the repo edits land in one commit.

Through all of it you are asked one band question per group or call and one go after the rehearsal. Say "ask me per file" at the go to OK each repo edit instead, one commit per file.

## What it reads

The survey writes nothing in the project. It gathers its facts into one `facts.json` in its work folder (under this PC's AskerDo data folder, in `onboard/<project>`):

- **The project**, with the commit it stands at, which the history pointers name.
- **The instruction files** Claude reads by the Project instructions setting (CLAUDE.md, AGENTS.md or both, at the start or nested), each clause by clause.
- **The rule files**: every file under `.claude/` and `.agents/`, every file an instruction file names or imports, and every script a hook or a `.mcp.json` server runs, each with what loads it and whether the paths it cites are still there.
- **The routines**: each skill and command with its scripts and the commits on them, so a routine in use tells itself from one nobody runs.
- **Every folder**, with its file count and last touch.
- **Claude's memory** for the project, **the board's records** for it, and the **conversion map** an earlier run left.

## The proposal and your calls

Claude judges the facts the way a person who knows the project would, opening only what a judgment needs. A system that works and was built with care is the reason to convert it, not to keep it.

- **Only what is live moves.** A rule that holds everywhere becomes a line on the project's profile; one scoped to some files or commands becomes a decision governing them, or a card with those triggers. A rule too long for one line (400 characters) keeps a short line that points at a record holding its detail. A routine in use becomes a procedure card; one nobody runs leaves with its folder. A handoff's state becomes the track's handoff and its next steps tasks in order. What the board already holds is linked, never written again.
- **What the code tells is not recorded.** A record earns its place only where the code cannot tell: something that looks wrong but is deliberate, or a trap in the tooling. Those records carry the `oddity` label, so a later run can keep or drop them as one group.
- **History leaves whole.** Logs, state notes, findings, maps and finished plans go with their folder. They are never read clause by clause for what they once said; the history pointer says where they are.
- **You rule by group.** What is alike (a history folder, the rules of one rule file, a set of skills, a plan's open tasks) comes to you as one question: its count, three examples and one answer. `keep` leaves it as it is and writes nothing; `drop` lets its folders go and writes none of its items; `convert` writes its items and lets its folders go. No agent rules on single entries for you.

Besides the groups, only a choice your wants settle comes to the band, each with Claude's pick marked: a private source (CLAUDE.local.md, anything git ignores, memory entries about you), a rule of yours that spans projects, a reader only you know of, or work only you know is still wanted. Claude checks each question's premise on the repo, the machine and the board first, and settles one whose premise fails from what it found.

## Depth, on your ask

Depth is one flag, and only you ask for it. It brings back the evidence behind each folder (who cites it, which code reads it, its commit subjects), the reason for each keep with its evidence rechecked on every run, the plan's warnings as waits, the repoint of cites in every file that stays, code and documents included, and one fresh reader pass after the handover: an agent that never saw the plan reads the project as a new session would and answers once, by group. Each group it finds comes to you as one question; it never runs again to empty its list.

## What changes on the board

Each record the import writes carries the label `import:<project>` and a ref to the item it came from, so it can be found and taken back:

- a workstream for the project (or the one already holding it), with a track for each live line of work and its handoff;
- tasks on those tracks, laid out so the ready set follows the old order;
- decision records, knowledge records and questions;
- rule lines on a profile named for the project, held on the project. If that name is taken, Claude picks a free one and tells you which;
- one history pointer per workstream: a knowledge record naming each folder that leaves the tree and the commit that holds it, with the `git show` command that reads it. A session reading a path under one of those folders is pointed at it. A later onboarding run that takes more folders out of the same workstream adds their lines to its pointer, with the commit that holds them.

The write pauses this PC's notifications while it runs, an hour at a time and renewed for as long as it runs, and lifts the pause when it ends; a pause you change meanwhile stays as you set it. If the lift fails, Claude tells you; use Resume now on the tray menu or the notifications page.

When the write is done, the import's tracks wait on the shelf for you to resume (`/askerdo resume`).

## What changes in your repo

Nothing changes until the handover. Your go covers every edit the rehearsal report listed, and they land in one commit, which Claude names:

|What|Becomes|
|-|-|
|CLAUDE.md (or the AGENTS.md Claude reads)|Rewritten from its ledger: it keeps what the project is, its working rules move to the board, a clause that is both a fact and a rule keeps the fact in new words, and one AskerDo section points at the board. No new instruction file is created.|
|The files a session reads that stay|Their cites of what goes are pointed at what it became: instruction files, procedure cards, and the skills, commands, agents and rules under `.claude/` and `.agents/`. Cites in code and in other documents stay as written: git and the history pointer answer them.|
|Kept files with lines that no longer hold|The line edits the rehearsal report listed, each checked against the file first.|
|Each old workflow folder|Deleted, moved, retired with its loaders, or kept as a pointer at its card. It stays, named with the reason, while it holds files git does not track, while a coverage gap sits in it, while code still reads it, or while a settings file outside git runs it. A folder with uncommitted changes is skipped and named.|
|Hooks, menus and servers that loaded the old rules|Retired with what they load, their entries taken out of `.claude/settings.json` or `.mcp.json` in the same commit. A hook that enforces a rule (refuses a push, runs a formatter) stays as the project's tool, and its rule still goes to the board.|
|Routines in use|Written to `docs/procedures/<name>.md` as procedure cards, each vouched at the handover's commit.|
|Claude's memory folder for the project|Renamed aside to `memory.retired-<date>` on your yes, never deleted.|

If anything is refused, every edit is put back and nothing is committed; Claude tells you what refused it. The handover writes a run report, `report.md` in the work folder: the counts written and dropped by kind and by group, your answers, the commit, the undo command and anything that went otherwise.

## Undo

Every id the import wrote is kept in a manifest on this PC (`manifest.json` in the work folder), in order, with the call that takes it back, and it names the handover's commit. Ask Claude to undo the onboarding: it prints the undo first, then runs it on your word. It walks the manifest backwards, the last import only unless you ask for every one.

|Record|What the undo does|
|-|-|
|Decision records and knowledge records, the history pointers among them|One withdraw request takes them all, which you Withdraw or Keep once on its card; the import reads undone after that press|
|Tasks, tracks, questions and the workstream it made|Deleted once that press lands, with the withdrawn records: their journals, history and activity go too, a track takes its handoffs, and edges go with their tasks. A task holding a step added since the import, and a track or workstream holding work the import did not write, stay and are named (that workstream closed)|
|A history pointer a later run added lines to|Its old text and triggers go back. Once a session has read it, the old text goes back by a fix request you press Fix or Keep on, and the import reads undone after that press|
|Rule lines|Removed, the profile taken off the project first; a line that replaced one already on the profile gets the old words back|
|Procedure cards|Stay: they follow their `docs/procedures` files, so they go when those files do; the commit the handover vouched them at is withdrawn|
|The handover's commit|The undo prints `git revert <commit>` (one per file after "ask me per file") and runs none without your word; one revert takes the whole handover back|

A group you drop after the write leaves on its own: Claude writes your drop answer into the proposal, runs the plan again, and the group undo takes back only that group's records, by the same withdraw request and purge, while the rest of the import stays.

The undo touches the board and, where the project keeps an AGENTS.md, rewrites the AGENTS.override.md AskerDo writes for Codex (kept out of git) from what the board still holds.

## A second run

The board keeps a conversion map for each project: every source a run converted, with its content hash at that commit and the records it became; each folder's end; each answer you gave; and each run with its commit. A second onboard or doctor run, from this PC or any other, reads the map first: Claude opens only what changed since the last run, the plan skips every item whose source is unchanged, and a question you answered is not asked again while what it was about is unchanged. Records an earlier import wrote without the `import:` label (the label `imported` with a `handoff-import:` ref) count as imported, and the paths their refs name are on the map from the first run. The manifest on this PC is the undo's alone, and the undo takes its run's rows off the map, except a source whose records all stay (ones you kept, say), which a later run reads as unchanged.

## Related

- [Concepts](concepts.md): what workstreams, tracks, handoffs, decisions, knowledge and rule lines are.
- [Settings and rules](settings-and-rules.md): profiles and rule lines, where the import puts the project's rules.
- The reference Claude reads for the run: `skills/onboard/SKILL.md` and the procedure card `docs/procedures/onboard-a-project.md`.
