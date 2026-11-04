---
name: onboard-a-project
title: Onboard a project onto the AskerDo board
summary: Move a project's handoff files, lists, decision logs, CLAUDE.md rules and Claude memory onto the board with the onboard skill, then record the run with its report.
everywhere: true
triggers:
  words: [onboard a project, onboard this project, move a project onto the board, import a project, askerdo onboard]
  commands:
    - skills/onboard/survey.mjs
    - skills/onboard/plan.mjs
    - skills/onboard/apply.mjs
---

# Onboard a project onto the AskerDo board

## Trigger

The helpers are in `${CLAUDE_PLUGIN_ROOT}/skills/onboard/` (`$H` below). A session opened on a project that kept its own handoff files, TODO lists, decision logs or Claude memory runs `/askerdo:onboard` to move them onto the board. The skill (`skills/onboard/SKILL.md`) holds every step; this card is the run's record, so each run reports how it went and the next run starts from what it learned.

## Preconditions

- The PC is on the board and the CLI answers. check: `node ~/.claude/askerdo/cli.mjs board`
- The session is a desktop session opened in the project, with the user engaged for the run.
- This card is on the board, so the last step's `proc ran onboard-a-project` resolves: the orchestrator's `proc scan` in the AskerDo checkout after the release puts it there. check: `node ~/.claude/askerdo/cli.mjs proc find onboard a project`

## Steps

### 1. Say the run's shape up front

Before the survey, tell the user what each step asks of them (the report, a few band questions, one press of I'm done when calls are left or else a go in chat, a go after the rehearsal, an OK per repo edit), that every row starts at a proposal they change only to disagree, what changes at the end, and what the import cannot carry. Skill section 1.

### 2. Survey, read only, and report

```sh
node "$H/survey.mjs" <project dir>
```

Report in a few lines, never a table, what the board holds, what was found by source and what could not be placed. Skill sections 2 and 3.

### 3. The discovery pass

Agents, or the session itself for a small project (a few dozen rows or commits), judge every row against the repo's current state and set its starting mark and why in `overrides.json`, shorten rule texts over 400 characters, turn the state file's next steps into ordered task rows, and leave `"call": true` on what they cannot settle. In a git repo one agent takes the history rows (rulings in commit messages, deleted planning files, the arc, reverts and dropped branches) and never makes a commit message a decision unless the user says so. Only calls go to the band. With no calls left, the reply's first line says nothing needs the user and the import is one short count line. Skill section 4.

### 4. The review page

```sh
node "$H/render.mjs" <work>
node "$H/serve.mjs" <work>
```

With calls, the user changes only rows they disagree with and presses I'm done. With none, the page is an optional link and the user's go in chat is I'm done, written by the plan:

```sh
node "$H/plan.mjs" <work> --chat-go --session <own id>
```

Skill section 5.

### 5. Plan and rehearse

```sh
node "$H/plan.mjs" <work> --session <own id>
node "$H/apply.mjs" <work> --board file:<scratchpad>/onboard-<slug>-1.db
```

Settle every waiting row, rehearse on a fresh scratch board, show the counts and ask for the go. Skill sections 6 and 7.

### 6. The live write

```sh
node "$H/apply.mjs" <work> --board live
```

Notifications pause for the write and resume after it. When agents run the work after, take the import's track in hand; otherwise it stays on the shelf for the user to resume. Skill section 8.

### 7. The handover

On the user's OK, edit by edit: hazards and running checks moved somewhere durable, the pointers written, CLAUDE.md reworded, the decision log frozen, the old checklist rewritten, step lists moved to `docs/procedures`, and Claude's memory folder for the project moved aside (never deleted). Commit in the project with explicit paths. Skill section 10.

### 8. Record the run

At the end, or at any stop, record the run with the report as its note; a deviated run opens the note with one sentence naming the step that differed and how, which is all the card's flag and draft edit carry. The report follows, in the skill's sections: counts, ran clean, deviated, fixed by hand, field bugs filed, undo. File each AskerDo trip-up where the session's rules in force say field bugs go; with no such rule it rides the deviated note only. Skill section 11.

```sh
node ~/.claude/askerdo/cli.mjs proc ran onboard-a-project clean --note "<report>"
node ~/.claude/askerdo/cli.mjs proc ran onboard-a-project deviated --note "<step-that-differed-and-how>. <report>"
```

## Verify

```sh
node ~/.claude/askerdo/cli.mjs track show <the imported TR-n>
node ~/.claude/askerdo/cli.mjs proc find onboard a project
```

- expect: the imported track's ready set holds only the tasks nothing waits on, and the card shows this run.

## References

- `skills/onboard/SKILL.md`: every step of the run, in full.
- `skills/onboard/plan.mjs`: the plan from the marks, the layout of ordered tasks.
- `skills/onboard/apply.mjs`: the rehearsal, the quiet live write, the manifest, the pointers and the undo.
- `hooks/board-server.mjs`: the notification pause route the live write sets.
