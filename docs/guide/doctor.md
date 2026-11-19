# Doctor a project

`/askerdo:doctor` checks a project that is already on the board and fixes what drifted, small by default: it checks what a session meets (rule lines in force, the board's shape, open tasks, procedure cards, the instruction and rule files, records whose source changed), puts alike findings to you as one group, and leaves the deeper checks for when you ask. It runs on the same engine as [onboarding](onboarding.md), so anything of the project's old way still in the repo is converted in the same pass. Nothing changes until you have seen a rehearsal of what will land.

## Onboard or doctor

Run `/askerdo:onboard` for a project with nothing on the board. Run `/askerdo:doctor` once the board holds it: a workstream naming the project, knowledge records on it, records from an earlier import, or a conversion map an earlier run left, from this PC or another. The doctor on a project the board does not hold says "not on the board yet: run askerdo:onboard" and stops.

## Running it

Open a Claude Code session in the project's folder and run:

```text
/askerdo:doctor
```

Claude tells you the run's shape first, then follows onboarding's arc: the facts and the checks, Claude's judgment of each finding in the proposal, your calls on the band, a rehearsal on a scratch board that also runs the undo, and one go. You are asked one band question per group or finding only you can settle, and one go after the rehearsal, which covers the board changes, the fixes and the repo edits. Say "ask me per file" at the go to OK each repo edit instead.

When a board read fails, the checks it feeds show as not read and the run stops there, so a check that never read the board never passes for clean; Claude names the failed call.

## What it checks

|Check|What it finds|The fix|
|-|-|-|
|Rule lines in force|A line over 400 characters or cut short; a line citing a path the repo no longer has or a folder an earlier run deleted or moved; a line a built-in line already covers; a line that differs from a decision|New words for the line (Claude gives them, or the new place when the conversion map names one); the line cleared; for a line that differs from a decision, a question to you with the decision's words as the fix. A line on a profile other projects hold too, or one that came from a ruling, is a question whose pick is to leave it|
|Board shape|An open task on no track; a parked track nothing will reopen; a project whose only workstream is an inbox holding real work; questions asleep for long with nothing set to wake them|A task whose name shares words with a live track goes onto it; the other inbox tasks are one group question (all onto one live track, or left in the inbox); an unpark condition from what the park reason names, while that record is still open, else a question; the asleep questions are one group question (wake them all, drop them all, or leave them). The tracks an import parked itself are left alone|
|Task shape|Open steps naming you, a look, real use or a later session, which the task's worker may not do; an old look close or close on a fact; a task once blocked or deferred on nothing named; a run unconfirmed for over a day; an inbox task with nothing to wake it|Each step its worker does stays; the rest move onto the track's look or review task, into a new task, or into a question for you. A look close becomes the `look` label; a fact becomes the description's done clause; a wait becomes an edge, a gate or a wake; a wake 14 days out. An unconfirmed run is only named: taking it over is your word|
|Procedure cards|Each error or warning the card check reports|An edit to the card file|
|The repo|An instruction file citing a file that is gone; a rule file a session loads citing paths that are gone or moved; the Project instructions setting changed since the last run, so Claude reads other instruction files|A repoint, or the line dropped when its subject is gone; the rule file repointed, or converted or dropped when nothing it cites is live; after a setting change, each file Claude reads is judged again|
|Changed sources|A record whose source changed since the run that converted it, by the conversion map|Claude reads the source against its records and amends what moved|
|Already on the board|An item of the proposal that the board already holds|Skipped and named, never written twice|

At depth, on your ask, the doctor also checks:

|Check|What it finds|The fix|
|-|-|-|
|Knowledge records|A record whose source in the repo says more than it does; records a newer one on the same subject holds whole; pairs on one subject that each hold what the other lacks; a record with no project that names a path of this repo or the project by name. Records an import wrote are its output and never come back as findings|An amend with the clauses it lacks; one group question to supersede each by its newer one, or leave them; the pairs named for a merge by hand; the project added|
|Task rewrites|A task with no done clause in its description, or whose job moved into its notes since its last rewrite|A rewrite of its description in Claude's words, ending in its done clause|
|Already on the board|An item of the proposal that the board already holds|The record gains a ref to that item and an amend (a note, for a task) with what it lacks, so the next run skips it by that ref|

## The findings and your calls

The checks write each finding with its evidence and the fix it proposes (the command it runs) to `checkup.json` in the work folder. Claude judges each against the facts and the files it opens, writes the fixes it agrees with into onboarding's proposal, and gives a fix the words or pick it needs (a reworded rule line, the track for a task); a finding it judges wrong stays out, and the run report says why. A group finding comes to you as one question with its count and three examples, and a finding only you can settle as a question of its own.

## What changes

On your go the board changes and the fixes run, after anything the pass creates; then the repo edits land in one commit, which Claude names. The rehearsal runs none of the fixes, since each changes a record only the real board holds: its report lists each as the go will run it, with the exact command and, for an amend, the text it adds.

## Undo

The manifest keeps each fix with what it changed, and the undo takes it back:

|Fix|What the undo does|
|-|-|
|A reworded or cleared rule line|Puts its old words back|
|A task put on a track|Back on its old track, or unplaced in the workstream it left with a wake 14 days out|
|A ref, project, label, gate or edge added|Removed|
|A question woken or dropped|Back asleep on the snooze it had|
|A history pointer's amend|Back to the text it had before, by a fix request the user presses once a session read it|
|Any other amend, a moved step, a description rewrite, a cleared close, a wake set on an inbox task, an unpark condition, a supersede, a line reworded from a ruling, and a ref added beside an amend that stands|Stay, and the undo says so: no command takes one back, and a line from a ruling changes only with a newer ruling|

Everything else undoes as onboarding's does ([Undo](onboarding.md#undo)).

## A rerun

Run the doctor again after a pass and it finds nothing it fixed: each fix changes what its check reads. It reads the project's conversion map from the board, so from any PC it opens only what changed since the last run and asks no question you answered while its subjects are unchanged ([A second run](onboarding.md#a-second-run)); a group whose members changed is asked again. What you left shows as left last time, counted apart from new findings, from any PC: the map holds each answer.

## Related

- [Onboard a project](onboarding.md): the engine, its proposal, rehearsal, handover and undo.
- The reference Claude reads for the run: `skills/doctor/SKILL.md` and the procedure card `docs/procedures/doctor-a-project.md`.
