---
name: doctor-a-project
title: Doctor a project already on the AskerDo board
summary: Check a project already on the board with the doctor skill, small by default, fix what drifted as fix items on one go, then record the run with its checkup counts.
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

Tell the user what it checks by default (rule lines, board shape, task shape, cards, the repo's instruction and rule files, records whose source changed, proposal items the board already holds), what `--depth` adds on their ask (knowledge drift and duplicates, task rewrites, a ref and amend on each record the board already holds), and what it asks of them: a short report, one band question per group or call only they can make, one go after the rehearsal covering the board writes, the fixes and the repo edits, with "ask me per file" open to them. Skill step 1.

### 2. The entry check and the checks

```sh
node "$D/checks.mjs" <project dir> --who <the user's name>
```

A project the board does not hold prints "not on the board yet: run askerdo:onboard" and exits 1: run `/askerdo:onboard` instead. A run whose board reads failed prints `Checkup incomplete` with the unread checks as "not read" and exits 2: stop, fix the failed reads and run it again; never report an unread check as 0. Otherwise it gathers the facts and writes `checkup.json`: each finding as an item of kind `fix` with its proposed fix, alike findings as one group with one call (the inbox tasks no track shares words with, the questions long asleep, and at depth the records a newer one holds whole), and a call for each finding only the user can settle. Report in a few lines, never a table, the Checkup line's findings per check, the calls left for the user, and the items the board already holds. `--depth` only on the user's ask. Skill step 2.

### 3. Judge the findings and write the proposal

Judge each finding against the facts and what you open, and write the fixes you agree with, with their calls, into `proposal.json` (an earlier run's, once written and handed over, renamed `proposal.<its go date>.json` first). Settle each call the repo or board answers in its `answer`, give a fix waiting on words or a pick its `fields.fix.text` or `fields.fix.args`, and send the calls left to the band, one question each, its premise checked and its gist saying what the thing or group is (its count and three examples), who reads it and what each answer changes. Anything of the old way still in the repo is judged by the onboard card's steps 3 and 4 (`onboard-a-project`). The doctor's own part of that judgment:

- Each task shape finding is judged with its block in hand (`task block T-n`, several ids in one call): a step its worker does stays, the rest move by `--move-steps` with the list in `fields.fix.stdin`; a wait and, at depth, a rewrite take your words in `fields.fix.args`; an unconfirmed run is reported with its holder, never fixed.
- A rule file or instruction file clause citing a gone path is a repoint where its subject moved; one citing nothing live is stale only when its subject is gone from the tree, the machine and the board.
- A changed source is read against its records, and what moved is amended in your words.
- The Project instructions setting changed since the last run: each file Claude reads by it is judged as onboarding judges CLAUDE.md, its ledger written in the proposal; a CLAUDE.md is never written beside an AGENTS.md Claude reads alone.
- A rerun judges fresh: a source converted and unchanged is never opened again.

Skill steps 3 and 4.

### 4. Plan and rehearse

```sh
node "$H/plan.mjs" <work> --session <own id>
node "$H/apply.mjs" <work> --board file:<scratchpad>/doctor-<slug>-1.db
```

The plan runs each kept fix after every create. The rehearsal runs the conversion's creates on the scratch board, reads them back with coverage, runs the undo with its one press, and lists each fix as it will run under the doctor's fixes in `rehearsal.md`. Show the user what the onboard card's step 6 lists, the fixes counted apart, and ask for the one go. Skill section 3, with onboard steps 6 to 8.

### 5. The live write and the handover

```sh
node "$H/plan.mjs" <work> --go --session <own id>
node "$H/apply.mjs" <work> --board live
node "$H/apply.mjs" <work> --coverage
node "$H/apply.mjs" <work> --handover
```

On the go, recorded in the proposal: the board writes and fixes, then the coverage pass and the repo edits in one commit, told as it lands; with "ask me per file", `--handover --file <path>` after each OK. A repo fix the handover has no batch for (a card's lint, a guide's line, a kept clause's repoint) the session makes and commits on the same go. A fresh reader pass runs only on the user's ask (the onboard card's step 8). Skill section 3, with onboard steps 9 to 12.

### 6. Record the run

At the end, or at any stop, record the run with the report as its note: the checkup counts per check (found, fixed, judged wrong, left), left last time counted apart, whether it ran at depth, then onboard's report parts. A deviated run opens the note with one sentence naming the step that differed and how, and says its outcome in the same call: `--fixed <commit>` (this card fixed in that commit), `--one-off "<why>"` (the steps stand) or `--filed T-n` (the work, filed through the ladder). Skill step 5.

```sh
node ~/.claude/askerdo/cli.mjs proc ran doctor-a-project clean --note "<report>"
node ~/.claude/askerdo/cli.mjs proc ran doctor-a-project deviated --note "<step-that-differed-and-how>. <report>" --one-off "<why-the-steps-stand>"
```

## Verify

```sh
node "$D/checks.mjs" <project dir> --who <the user's name>
```

- expect: the Checkup line counts no finding the run fixed; what the user left counts as left last time.

## References

- `skills/doctor/SKILL.md`: every step of the run, in full.
- `skills/doctor/checks.mjs`: the entry check, the facts, the reads, the checks (rules, board shape, task shape, cards, the repo, changed sources, and at depth knowledge) and the reconcile, each finding a fix item with its proposed fix and its call, alike findings one group call, in `checkup.json`.
- `skills/onboard/plan.mjs`: the fix steps after every create, and the amend for a reconciled record.
- `skills/onboard/apply.mjs`: the rehearsal's fix list, the manifest's fix entries and their undo.
- `docs/procedures/onboard-a-project.md`: the judgment of anything of the old way, which the doctor shares.
