# Handoff: <Name> (<WS-n>)

A workstream on the board hands off through its tracks: `/askerdo handoff` writes the held track's handoff on the board, and `/askerdo resume <TR-n>` prints the kickoff, whose Read line points at this folder's [rules.md](rules.md) and [map.md](map.md).

This README's resume and [now.md](now.md) serve a workstream that keeps its live state in this folder instead; its kickoff is the last section of now.md. Its template:

```text
Resume <WS-n> (<Name>). Read <handoff dir>/README.md and follow it.
Focus: <the one next action from now.md, in a sentence>
Waiting on the user: <approvals or actions pending with the user; or "nothing">
```

Line 1 never changes. The other two are filled in fresh at each handoff, one sentence each; all detail belongs in now.md.

## Resume (read in this order, nothing else up front)

1. [now.md](now.md): live state, the next action, in-flight operations, open gates and the user's pending actions.
2. [rules.md](rules.md): standing rules for this workstream, including the never-replay list.
3. The board: `node ~/.claude/askerdo/cli.mjs show <WS-n> --brief`, `track list --workstream <WS-n>`, `list --project <project dir> --json` (open questions), then `show <T-n> --brief --journal` for your task: its tail holds the newest findings and the user's requirements.
4. [map.md](map.md): grep it for the task code, id, path or tool you need; never read it whole.

Before anything else, make sure this session has its depth-guard marker: `~/.claude/projects/<project slug>/<session id>/depth-guard.json` containing `{"soft":350000,"hard":450000,"remind":25000}` (session id = the scratchpad path's last segment; project slug = the project path with `:`, `/` and `\` as `-`).
When the AskerDo mod runs in this session it writes the marker itself, so this step only finds the file and moves on; without the mod, write it now. Writing the same content again changes nothing.
Without the marker the 30 and 40 percent handoff notices and the subagent depth guard stay silent, and the silence looks the same as a shallow session.

Then run now.md's "Verify first" checks before acting. Reality wins over the handoff.

## Sources of truth (never duplicate them here)

|Kind|Lives in|
|-|-|
|Tasks, status, measured numbers|Board tasks and journals (`note T-n`), never this folder|
|The order of work|The workstream's tracks, their tasks and depends-on edges|
|Questions and answers|Board questions under <WS-n>|
|History|git log and board journals|

## Writing a handoff (the whole procedure)

1. Reach a clean stopping point (from the 30 percent notice the handoff is your call; hand off by about 40): let running agents land and record their results on the board, start nothing new. Agents die with their session.
2. Board first: each task you moved is `completed` (gate met), `in_progress` with an exact resume point in its journal, or `open` with what blocks it in its journal.
3. Rewrite [now.md](now.md) from scratch: current state only, no history, within budget. Edit [rules.md](rules.md) or [map.md](map.md) only if a rule or a fact changed; delete what went stale in the same edit.
4. Make sure every approval or action pending with the user, every open question and unsettled one-shot operation appears in now.md; fill in the kickoff template as now.md's last section, "Kickoff".
5. Keep the depth-guard marker step in Resume and in now.md's Verify first. `node <plugin root>/scripts/check-handoff.mjs <handoff dir>` names a missing one; run it, then commit the folder atomically with explicit paths.
6. End the handoff reply with that kickoff as a fenced `text` block under a label line. It is always the last thing in the reply.

## Keeping it lean

|File|Budget|Rule|
|-|-:|-|
|now.md|10 KB|Replaced wholesale each handoff; never appended|
|rules.md|11 KB|Present-tense rules; a rule that stops applying is deleted|
|map.md|16 KB|Facts and pointers only; no narrative|
|README.md|5 KB|This protocol; changes only when the protocol does|

Budgets are bytes (`wc -c`). No line runs over 400 characters. Over budget means something belongs elsewhere: progress to the board, rulings to the workstream's decisions, detail to evidence.
