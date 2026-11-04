# Now (<WS-n>)

Live state for a workstream that hands off through this folder. A workstream whose tracks are on the board keeps this in each track's handoff instead (`/askerdo handoff`, `/askerdo resume <TR-n>`), and this file stays as written.

## Where things stand

- **Board:** <WS-n>, its open tracks and the tasks in progress (codes in map.md). Open <WS-n> questions: none.
- **Machine:** what is running, what is stopped, which flags or servers are up.

## Next actions, in order

1. The one next action, with its task id.
2. What follows it.

## In-flight operations

- None.

## The user's pending decisions and actions

- None for <WS-n>.

## Verify first

- Depth-guard marker for this session: `~/.claude/projects/<project slug>/<session id>/depth-guard.json` = `{"soft":350000,"hard":450000,"remind":25000}` (README Resume; already there when the AskerDo mod runs, otherwise written now).
- `git branch --show-current` is `<branch>`; `git log --oneline -1` is this handoff's commit or later; `git diff --cached --name-only` is empty.
- `node ~/.claude/askerdo/cli.mjs show <T-n> --brief --journal` tail.

## Kickoff

```text
Resume <WS-n> (<Name>). Read <handoff dir>/README.md and follow it.
Focus: <the one next action, in a sentence>
Waiting on the user: nothing.
```
