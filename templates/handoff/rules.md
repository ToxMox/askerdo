# Standing rules (<WS-n>)

CLAUDE.md and the profile rule lines (yours and the project's) apply too; these are <WS-n>'s own. Rulings recorded on the board are not reopened: a decision found unworkable gets a new question scoped to <WS-n> with the evidence, and work continues on everything it does not block.

## Scope and authority

- What this workstream is for, and what it never touches.
- What is authorized without asking; what the user decides.

## Orchestrator and delegation

- The orchestrator owns shared files, git and every acceptance verdict. Agents get disjoint named paths.
- A brief is self-contained: one lane, its task id, the files it may write, stop points, a response cap, and a `-state.md` note it keeps current.
- Depth guard: the marker is written at session start (README Resume); agents past their soft limit finish the step, update the state note and hand back.

## Git

- Work on `<branch>` in <project dir>. Commit coherent slices with explicit paths, atomically (`git add -- FILES && git commit -m MSG -- FILES`). Never blanket-stage.

## Never replay

- One-shot operations are journaled on their task before and after (`note T-n`); on resume, inspect receipts before anything, never replay on the strength of a record alone.
