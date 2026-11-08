# Doctor a project

`/askerdo:doctor` checks a project that is already on the board and fixes what drifted: rule lines that cite files the repo no longer has, tasks on no track, parked tracks nothing will reopen, knowledge records that no longer match their sources, duplicates, procedure cards with errors, guides citing gone files, and whatever an earlier run left. It runs on the same engine as [onboarding](onboarding.md), so anything of the project's old way still in the repo is converted in the same pass. Nothing changes until you have seen what will land.

## Onboard or doctor

Run `/askerdo:onboard` for a project with nothing on the board. Run `/askerdo:doctor` once the board holds it: a workstream naming the project, knowledge records on it, records from an earlier import, or a conversion map an earlier run left, from this PC or another. The doctor on a project the board does not hold says "not on the board yet: run askerdo:onboard" and stops.

## Running it

Open a Claude Code session in the project's folder and run:

```text
/askerdo:doctor
```

Claude tells you the run's shape first, then follows onboarding's arc: the facts and the checks, Claude's judgment of each finding in the proposal, your calls on the band, a rehearsal on a scratch board, and one go. You are asked for a band question only for a finding only you can settle, and one go after the rehearsal, which covers the board changes, the fixes and the repo edits. Say "ask me per file" at the go to OK each repo edit instead.

When a board read fails, the checks it feeds show as not read and the run stops there, so a check that never read the board never passes for clean; Claude names the failed call.

## What it checks

|Check|What it finds|The fix|
|-|-|-|
|Rule lines in force|A line over 400 characters or cut short; a line citing a path the repo no longer has or a folder an earlier run deleted or moved; a line a built-in line already covers; a line that differs from a decision|New words for the line (Claude gives them, the whole text kept in a record the line points at, or the new place when the conversion map names one); the line cleared; the decision's words. A line on a profile other projects hold, or one that came from a ruling, is a call you settle where it lives|
|Board shape|An open task on no track; a task in progress with nobody on it since before the project's recent work; a parked track nothing will reopen; a project whose only workstream is an inbox; no profile while the repo holds rules; a question asleep for long with nothing to wake it|The task onto the track that shares its words (else you pick one); back to open with a note; an unpark condition from what its reason names, while that record is still open; the rest are calls. The tracks an import parked itself are left alone|
|Knowledge records|A record whose source file is gone or is an import's pointer now; one whose source says more than it does; two records on the same subject; a record with no project that names a path of this repo (`tools/`, never the bare word) or the project by name. Records the pass itself wrote are its output and never come back as findings|An amend saying where the source is now, or with the clauses it lacks; the older superseded by the newer when the newer holds all of it; the project added|
|Procedure cards|Each error or lint the card check reports|An edit to the card file|
|The repo|CLAUDE.md or AGENTS.md citing a file that is gone; the Project instructions setting changed since the last run, so Claude reads other instruction files|A one-line repoint, or the line dropped when all it cites is gone; after a setting change, each file Claude reads is judged again|
|What earlier runs kept|A keep or drop whose evidence changed; a kept rule file citing paths that are gone or moved|Judged again: converted, dropped, or kept with a reason of a named kind and fresh evidence; the rule file repointed, or converted or dropped when nothing it cites is live|
|Earlier runs|What you left last time; hand work the last run reported|What you left stays left and asks nothing again while what it was about is unchanged; hand work is a call|
|The conversion map|A record whose source changed since the run that converted it; a record gone from the board while its source is still in the repo|Claude reads the source against its records and amends what moved; converting it again or leaving it gone is a call|

A record the board already holds is never written twice. When an item of the old way matches a record by its title, the record gains a ref to that item, and an amend (a note, for a task) with what it lacks; the next run skips it by that ref.

## The findings and your calls

The checks write each finding with its evidence and the fix it proposes (the command it runs) to `checkup.json` in the work folder. Claude judges each against the facts and the files it opens, writes the fixes it agrees with into onboarding's proposal, and gives a fix the words or pick it needs (a reworded rule line, the track for a task); a finding it judges wrong stays out, and the run report says why. A finding only you can settle comes to the band as a question: run the fix or leave it, or for a task on no track, which live track takes it.

## What changes

On your go the board changes and fixes run, after anything the pass creates; then the repo edits, one commit per folder, each named as it lands. The rehearsal runs none of the fixes, since each changes a record only the real board holds: its report lists each as "would run", with the exact command and, for an amend, the text it adds.

## Undo

The manifest keeps each fix with what it changed, and the undo takes it back:

|Fix|What the undo does|
|-|-|
|A reworded or cleared rule line|Puts its old words back|
|A task put on a track|Back on no track in the workstream it left, or on its old track|
|A task set back to open|Back to in progress|
|A ref or project added to a record|Removed|
|An amend, a supersede, an unpark condition, a line reworded from a ruling|Stay, and the undo says so: no command takes one back, and a line from a ruling changes only with a newer ruling|

Everything else undoes as onboarding's does ([Undo](onboarding.md#undo)).

## A rerun

Run the doctor again after a pass and it finds nothing it fixed: each fix changes what its check reads. It reads the project's conversion map from the board, so from any PC it opens only what changed since the last run and asks no call you answered while its subjects are unchanged ([A second run](onboarding.md#a-second-run)). What you left shows as left last time, counted apart from new findings, from any PC: the map holds each answer.

## Related

- [Onboard a project](onboarding.md): the engine, its proposal, rehearsal, handover and undo.
- The reference Claude reads for the run: `skills/doctor/SKILL.md` and the procedure card `docs/procedures/doctor-a-project.md`.
