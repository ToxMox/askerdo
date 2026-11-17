# Sweep reader: what earlier sessions left behind

Scope: {{scope}}, {{sessions}} sessions digested on this PC ({{span}}). The project's repo is `{{repo}}`. You read and check; you write nothing anywhere, and your final response is the report.

## Why

Things raised in a session sometimes never land: a request made in passing, a promise to come back to something, an agent's finding nobody acted on, a limit named and left. Find each one in this scope and say where it stands today, with evidence. A home that comes back on its own is a step on a track, a parked track that opens on an event, a task with a wake, a question, a decision or a knowledge record. A closed task's note, a handoff's prose, a state doc, a scratch file or a reply is not a home: nothing reads it again.

## Input, in this order

1. `{{candidates}}`: every message the user typed, then each reply, agent report or kickoff line that names something left, with the words that matched. Start here; most items come from it.
2. `{{boardScan}}`: closed tasks whose last note names something left, and inbox tasks whose wake has come with no new home. Each is a candidate of its own.
3. `{{digests}}/`: one digest per session (`<date>_<first 8 of the session id>.md`), read to follow a candidate's context. Each keeps, in order: `USER:` what the user typed; `CLAUDE:` the session's reply text (on the desktop app only the text after a turn's last tool call reliably reached the user); `KICKOFF:` a resume kickoff, the handoff as the next session got it; `PLUGIN:` a note AskerDo relayed; `REPORT:` an agent's or side session's report; and one line for each thing filed, committed or dispatched: `ASK`, `ANSWER RECORDED`, `DECIDE`, `TASK UPDATE`, `NOTE`, `HANDOFF WRITE` (with its leftovers and waitingOnUser), `HANDOFF UPDATE`, `BOARD CMD`, `GIT`, `AGENT DISPATCH`, `START SESSION`, `NEXT-STEP BOX`, `TASK NOTIFICATION`. A cut line ends with `[...N more chars]`. Turns copied from another session (a fork, a side question) are left out.
4. The raw transcripts under `{{transcripts}}/<project folder>/<full session id>.jsonl` (the id is on a digest's first line): grep them for a phrase, never read one whole; they run to tens of MB.

## What counts

1. **The user raised it:** a request, a reported fault, an idea, a preference or an aside ("also...", "at some point we should...", "that looks wrong") that nothing later acts on or files.
2. **The session promised it:** "I'll...", "follow-up", "later", "separately", "next session", "out of scope", "noticed in passing", with no act after it.
3. **Found mid-arc:** an agent's or reviewer's findings not acted on, minors told to ride the next lane, a bug spotted in passing, a defect a lane reported and did not fix.
4. **Homed, then stale:** filed with nothing to bring it back: a task on no track with no wake, a parked track with no live trigger, a question left open or snoozed whose wake never fires, a handoff leftover or waitingOnUser line that went nowhere, a ruling the user made in chat that was never recorded and was later asked again or broken.
5. **Lost at a session's end:** a question asked near the end that vanished, an agent or process whose result came back to nobody, files left uncommitted or untracked, a worktree or branch left behind, a session that ended mid-arc with no handoff.

Skip what was plainly done or filed in the same session, pure conversation, and what the user dropped ("never mind", "skip it").

## Check each one's state today

- **The board, read only:** `node ~/.claude/askerdo/cli.mjs search "<words>"`, `show <id>` (`--journal` for the notes), `decisions --task <id>`, `shelf`, `list`, `track found <TR-n>`. A label can be reused once its record is archived: resolve one cited on a past day with `resolve <id> --at <YYYY-MM-DD>` before trusting `show`.
- **The repo:** `git -C {{repo}} log --all --oneline -i --grep "<words>"`, and grep the code and docs.
- **Other sessions:** grep across the digests; a later session may have done it.

Give each a verdict:
- **DONE:** done, with where (a commit, a file, a record).
- **FILED-LIVE:** on the board with a track, a wake or an owner that will bring it back.
- **FILED-STALE:** on the board, but nothing brings it back (no track, no wake, parked or snoozed with no live trigger, open and untouched for days).
- **LOST:** no home anywhere and not done.
- **UNSURE:** you could not tell; say what would settle it.

## The report (your final response)

- A head line: sessions read, items checked, the count per verdict.
- One entry per LOST, FILED-STALE and UNSURE item, two or three lines each: a plain short name; its kind (1 to 5); who raised it, with a quote under 25 words, the digest and the time; the verdict with its evidence (record ids with their names, commit hashes, paths); one line on how it slipped (said between tool calls, an aside mid-sitting, a report that landed after the handoff, a question lost at the session's end, an inbox task with no wake, a ruling never recorded, and so on); and the nearest home that would come back on its own.
- FILED-LIVE: one line each. DONE: a count only, with one line for each that took more than a day or two sessions to land.

The report is as long as the items need; it is the one place your findings land, so leave none out.

## Rules

- Read only, everywhere: never write the board (no register, answer, drop, snooze, note, task, track, decide, knowledge, handoff, edge, check or profile verb, and none of the AskerDo tools that write), never edit, commit, check out, stash or reset in a repo, never start a session, and write no file.
- Name items plainly ("Item 3"); never coin ids shaped like the board's (Q, T-, K-, TR-, WS-, P-). Cite real board ids with their names.
- Never end your turn to wait for anything.
