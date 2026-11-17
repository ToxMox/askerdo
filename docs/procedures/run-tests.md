---
name: run-tests
title: Run the tests without wasting time
summary: "The test rules in force from the profiles, then scripts/run-tests.mjs: targeted files while working (plugin ones too), the full suite when tests.fullRun says, the plugin set when the mod changed."
triggers:
  words: [run the tests, test suite, full suite, run node --test]
  commands: ['node --test', 'claude plugin test', run-tests.mjs]
  files:
    - test/**/*.test.mjs
repos: {}
record: command
---

# Run the tests without wasting time

## Trigger

Any session or agent about to run `node --test` or `claude plugin test` in this repo, since time lost to test runs compounds into hours and days.

## Preconditions

- None.

## Steps

### 1. Read the test rules in force

The policy lives in the profiles, not here: `tests.policy` (few, standard, off), `tests.fullRun` (end, merge, never) and `tests.pinWording`, resolved for your track, task or project, narrowest wins. Where the mod runs, the rules in force already ride your session prompt and every agent brief, so read them there; this command shows each rule and where it came from, for a session without the mod or when a rule's source matters.

```sh
askerdo profile show-effective <tr-or-task-or-dir> --rules
```

### 2. Take the starting count from the dispatch

Never run a full suite just to learn the count before working: the dispatch (its brief or its run details) or the last lane's report gives it.

### 3. Run only the files you touch or break while working

`scripts/run-tests.mjs` is the one way to run the tests here: it unsets the store seams for the child (some tests spawn the CLI with the runner's environment), points HOME and USERPROFILE at a fresh throwaway folder, fails the run when the tests left anything in that home, removes it, and exits with the run's own status. Name the files; the full suite takes minutes and other lanes may be running theirs.

The console shows only each failing test (file and line, name, the assertion's message and the head of its stack) and one counts line with the exit code. The whole reporter output goes to a log file in `askerdo-test-logs/` under the OS temp folder, named on the script's `log` line; logs older than seven days are removed. Read the console whole, with no pipe or filter; `--verbose` also streams the whole output to the console.

```sh
node scripts/run-tests.mjs <files>
```

### 4. Run the full suite when tests.fullRun says

`end`: once, right before the final commit. `merge`: skip it, the orchestrator runs one after each merge. `never`: skip it. A brief's own instruction for this lane stands beside the rule. Never rerun it to double check.

```sh
node scripts/run-tests.mjs
```

Gate a commit on the script's own exit status, never on a pipe's: `claude plugin test . | tail && git commit` once committed and pushed two failing tests (2026-10-22).

### 5. Plugin tests only when the mod changed

Run the plugin tests only when `hooks/mod/` or a plugin test changed. While working, name the plugin test files you touch or break, `node scripts/run-tests.mjs --plugin <files>`: each runs alone, one after another, the way the whole-set run starts its children (`plugin test --file <file> <repo>`), with the same seams unset, throwaway home, log and console. The runner reads each child's report line and draws its cases as the whole set does; a child that reports nothing, or reports no case, fails the run. Run the whole plugin set, `--plugin` with no files, once at the end, after the mod's targeted node files and plugin files pass. A named file must be a `*.test.ts` or `*.test.tsx` in this repo: anything else fails the run before it takes a turn.

`--plugin` runs `plugin test .` on the engine the mod runs under, the desktop app's own `claude.exe` in the newest version folder the app holds, under `%LOCALAPPDATA%/Claude-Data/<profile>/claude-code/<version>/<build>/` or, on a PC whose app keeps its data in Roaming, `%APPDATA%/Claude/claude-code/<version>/<build>/`, and names the engine it ran. The `claude` on PATH is a separate terminal install, used only when its `--version` names the same version as the app's newest folder.

The plugin set has a 5 s limit per test, which a CPU the node tests load breaks, and two full node runs at once push each other's server and git children past their limits. So the runners on this PC, from every checkout, take turns through `askerdo-test-turns/` under the OS temp folder: a plugin run waits for each run started before it, a node run waits for a plugin run started before it, and a full node run (no files named) waits for a full node run started before it, naming on the console the pid and folder it waits for. A node run naming test files never waits for a node run; a plugin run naming files is a plugin run and takes the same turn as the whole set, since its cases keep the same 5 s limit. A killed runner's turn is dropped once its pid is gone or its file has not been touched for a minute.

When a full run waits, let it: keep it running in the background, carry on with work that needs no test run, and read its result when it ends. Never kill a waiting run to start another, and never name every file to get past the wait: that run loads the PC beside the full one and both can fail.

```sh
node scripts/run-tests.mjs --plugin hooks/mod/tests/questions.test.tsx
node scripts/run-tests.mjs --plugin
```

## Verify

```sh
node scripts/run-tests.mjs <files>; echo "exit $?"
```

- expect: exit 0, a counts line with 0 fail, and no line naming files left in the throwaway home (after `--plugin`, the `.claude.json` that claude.exe writes itself is allowed).

## References

- `scripts/run-tests.mjs`: the runner every step calls.
- `server/verbs/profile-rules.mjs`: the test settings and their built-in values (today's rules).
- `test/`: the suite this procedure runs.
- `hooks/mod/`: a change here is what calls for the plugin tests.
