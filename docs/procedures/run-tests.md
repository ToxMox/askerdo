---
name: run-tests
title: Run the tests without wasting time
summary: "The test rules in force from the profiles, then scripts/run-tests.mjs: targeted files while working, the full suite when tests.fullRun says, --plugin only when the mod changed."
triggers:
  words: [run the tests, test suite, full suite, run node --test]
  commands: ['node --test', 'claude plugin test', run-tests.mjs]
  files:
    - test/**/*.test.mjs
repos: {}
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

### 2. Take the starting count from the brief

Never run a full suite just to learn the count before working: the brief or the last lane's report gives it.

### 3. Run only the files you touch or break while working

`scripts/run-tests.mjs` is the one way to run the tests here: it unsets the store seams for the child (some tests spawn the CLI with the runner's environment), points HOME and USERPROFILE at a fresh throwaway folder, prints the pass and fail counts, fails the run when the tests left anything in that home, removes it, and exits with the run's own status. Name the files; the full suite takes minutes and other lanes may be running theirs.

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

Run the plugin tests only when `hooks/mod/` or a plugin test changed. They have no file filter, so every run is the whole plugin set: run them once the mod's targeted node files pass, and again only after a fix they caught.

`--plugin` runs `plugin test .` on the engine the mod runs under, the desktop app's own `claude.exe` in the newest version folder under `%LOCALAPPDATA%/Claude-Data/<profile>/claude-code/<version>/<build>/`, and names the engine it ran. The `claude` on PATH is a separate terminal install, used only when its `--version` names the same version as the app's newest folder.

```sh
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
