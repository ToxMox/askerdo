---
name: doctor-a-project
title: Doctor a project already on the AskerDo board
summary: Check a project already on the board with the doctor skill, judge each finding and fix what drifted as fix items in the proposal on one go, then record the run with its checkup counts.
everywhere: true
triggers:
  words: [doctor a project, doctor this project, askerdo doctor, check a project on the board, project checkup]
  commands:
    - skills/doctor/checks.mjs
    - skills/onboard/plan.mjs
    - skills/onboard/apply.mjs
---

# Doctor a project already on the AskerDo board

## Trigger

The helpers are in `${CLAUDE_PLUGIN_ROOT}/skills/doctor/` (`$D` below) and `${CLAUDE_PLUGIN_ROOT}/skills/onboard/` (`$H`). A session opened on a project the board already holds (a workstream naming it, knowledge on it, records from an earlier import, or rows on its conversion map) runs `/askerdo:doctor` to find what drifted and fix it. The skill (`skills/doctor/SKILL.md`) holds every step; this card is the run's record, so each run reports how it went.

## Preconditions

- The PC is on the board and the CLI answers. check: `node ~/.claude/askerdo/cli.mjs board`
- The session is a desktop session opened in the project, with the user engaged for the run.
- This card is on the board, so the last step's `proc ran doctor-a-project` resolves. check: `node ~/.claude/askerdo/cli.mjs proc find doctor a project`

## Steps

### 1. Say the run's shape up front

Tell the user what it checks, what it asks of them (a short report, band questions only for what the session cannot settle, one go after the rehearsal covering the board writes, the fixes and the repo edits, with "ask me per file" open to them) and that records the board already holds gain a ref and an amend, never a second copy. Skill step 1.

### 2. The entry check and the checks

```sh
node "$D/checks.mjs" <project dir>
```

A project the board does not hold prints "not on the board yet: run askerdo:onboard" and exits 1: run `/askerdo:onboard` instead. A run whose board reads failed prints `Checkup incomplete` with the unread checks as "not read" and exits 2: stop, fix the failed reads and run it again; never report an unread check as 0. Otherwise it gathers the facts and writes `checkup.json`: each finding as an item of kind `fix` with its proposed fix, and a call for each only the user can settle; report in a few lines, never a table, the Checkup line's findings per check and the calls left for the user. Skill step 2.

### 3. Judge the findings and write the proposal

Judge each finding against the facts and what you open, and write the fixes you agree with, with their calls, into `proposal.json` (an earlier run's, once written and handed over, renamed `proposal.<its go date>.json` first). Settle each call the repo or board answers in its `answer`, give a fix waiting on words or a pick its `fields.fix.text` or `fields.fix.args`, and send the calls left to the band, one question each, asked as the onboard card's step 4 says (its premise checked, its gist saying what the thing is, who reads it and what each answer changes). Anything of the old way still in the repo is judged by the onboard card's steps 3 and 4 (`onboard-a-project`): the aim as a listing, placing everything with the clause as the unit, what each home carries, staleness from evidence, the reasons a keep may carry, the gaps known today. The doctor's own part of that judgment:

- A judgment the facts mark `rejudge` (a `kept` finding: its reader gone, its cite unresolved, its event come, its file changed, or no evidence recorded) is made again from the facts: convert the thing, drop it with its evidence, or keep it with a reason of a named shape and fresh evidence. It is answered in the proposal's items, folders or ledger, never copied in as a fix and never left; a judgment marked `holds` stands.
- A kept clause or kept file is held to the test a rule line is: a clause or rule file citing a gone path is a repoint where its subject moved, and one citing nothing live is stale only when its subject is gone from the tree, the machine and the board.
- The Project instructions setting changed since the last run: each file Claude reads by it is judged as onboarding judges CLAUDE.md, its ledger written in the proposal; a CLAUDE.md is never written beside an AGENTS.md Claude reads alone.
- A rerun judges fresh: a source converted and unchanged is never opened again, and an earlier run's view of what is workflow is never copied.

Skill steps 3 and 4.

### 4. Plan and rehearse

```sh
node "$H/plan.mjs" <work> --session <own id>
node "$H/apply.mjs" <work> --board file:<scratchpad>/doctor-<slug>-1.db
```

The plan runs each kept fix after every create. The rehearsal runs the conversion's creates on the scratch board, lists each fix as "would run" in the log and in `rehearsal.md`, and hands the plan over on a copy of the repo. The fresh reader (the onboard card's step 6) runs when the plan changes the repo (a rewrite, a move, a delete, a loader retiring) or a kept reason's event has passed; otherwise the report names the last fresh read and its date. Show the user what the onboard card's step 7 lists, the fixes counted apart, and ask for the one go. Skill section 3, with onboard steps 7 to 9.

### 5. The live write and the handover

```sh
node "$H/plan.mjs" <work> --go --session <own id>
node "$H/apply.mjs" <work> --board live
node "$H/apply.mjs" <work> --coverage
node "$H/apply.mjs" <work> --handover
```

On the go, recorded in the proposal: the board writes and fixes, then the coverage pass and the repo edits, one commit per folder, each told as it lands; with "ask me per file", `--handover --file <path>` after each OK. A repo fix the handover has no batch for (a card's lint, a guide's line, a kept clause's repoint) the session makes and commits on the same go. When the handover's real tree differs from the rehearsal copy, the fresh reader runs again on it before the report. Skill section 3, with onboard steps 9 to 11.

### 6. Record the run

At the end, or at any stop, record the run with the report as its note: the checkup counts per check (found, fixed, judged wrong, left), left last time counted apart, the judgments made again and how each came out, then onboard's report parts (the fresh reader's list, or the date of the last one when it did not run). A deviated run opens the note with one sentence naming the step that differed and how. Skill step 5.

```sh
node ~/.claude/askerdo/cli.mjs proc ran doctor-a-project clean --note "<report>"
node ~/.claude/askerdo/cli.mjs proc ran doctor-a-project deviated --note "<step-that-differed-and-how>. <report>"
```

## Verify

```sh
node "$D/checks.mjs" <project dir>
```

- expect: the Checkup line counts no finding the run fixed; what the user left counts as left last time.

## References

- `skills/doctor/SKILL.md`: every step of the run, in full.
- `skills/doctor/checks.mjs`: the entry check, the facts, the reads, the checks (rules, board shape, knowledge, cards, the repo, what earlier runs kept, earlier runs, the map's sources) and the reconcile, each finding a fix item with its proposed fix and its call, in `checkup.json`.
- `skills/onboard/plan.mjs`: the fix steps after every create, and the amend for a reconciled record.
- `skills/onboard/apply.mjs`: the rehearsal's would-run list, the manifest's fix entries and their undo.
- `docs/procedures/onboard-a-project.md`: the judgment of anything of the old way, which the doctor shares.
- `skills/onboard/fresh-reader.md`: the fresh reader's brief.
