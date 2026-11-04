---
name: release
title: Cut an AskerDo release
summary: "Bump the version in both plugin manifests, date the changelog's Unreleased entries, run the build, and commit as `release: x.y.z`."
triggers:
  words: [release, cut a release, version bump, bump the version, ship a version]
  commands: ['commit -m "release:']
  files:
    - .claude-plugin/plugin.json
    - .claude-plugin/marketplace.json
repos: {}
---

# Cut an AskerDo release

## Trigger

The maintainer asks for a release of the plugin, so that installed users pick up what has landed since the last one (the updater compares manifest versions, never commits).

## Preconditions

- The maintainer asked for this release.
- The working tree is clean. check: `git status --short` prints nothing.
- `## Unreleased` in `CHANGELOG.md` holds one bullet for every change that ships.
- The suite is green. check: `node scripts/run-tests.mjs` exits 0.
- Whether the committed tray exe is signed, which decides step 4: a rebuild committed between releases is unsigned. check: `node scripts/check-tray-signed.mjs` exits 0 when it is signed.

## Steps

### 1. Pick the version

Read the current version, then pick the new one yourself, `<x.y.z>` below (semver by what changed), and state it; never ask the maintainer for one.

```sh
node -p "require('./.claude-plugin/plugin.json').version"
```

### 2. Bump both manifests

Edit `.claude-plugin/plugin.json`: set `version` to `<x.y.z>`. Edit `.claude-plugin/marketplace.json`: set the plugin entry's `version` to the same value. At install time `plugin.json` wins and the entry's copy is ignored, but `test/manifests.test.mjs` pins the two equal, so a drift fails the suite.

### 3. Bump the tray crate only if the tray changed

The crate names the release its exe was built under, so it moves only in a release that rebuilds the exe (the rule stated in the `release: 0.5.34` commit). Find the last release commit and look for changes under `tray/src/`:

```sh
git log -1 --format=%H --grep="^release: "
git diff --stat <sha>..HEAD -- tray/src
```

If the diff prints nothing, skip to step 5. Otherwise edit `tray/Cargo.toml`: set the package `version` to `<x.y.z>`, then rebuild the committed exe and its notices (dev-side only, with the toolchain pinned in `tray/rust-toolchain.toml`):

```sh
node scripts/build-tray.mjs
```

### 4. The maintainer signs the tray exe when it is unsigned

Whenever the release would ship an unsigned `assets/askerdo-tray.exe`: step 3 rebuilt it, or the preconditions' check refused the committed one (a rebuild committed between releases). Every rebuild writes it unsigned, and the release ships it signed. The maintainer signs `assets/askerdo-tray.exe` by hand with a code-signing tool. Ask for it and wait; the session never signs. The check below reads the signature on disk, before the release commit carries it: it prints `Valid`, or nothing is committed.

```sh
pwsh -NoProfile -Command "(Get-AuthenticodeSignature assets/askerdo-tray.exe).Status"
```

### 5. Date the changelog

Edit `CHANGELOG.md`: insert `## <x.y.z> - <yyyy-mm-dd>` and a blank line directly under `## Unreleased`, so the Unreleased heading stays and is left empty, and every bullet that was under it now sits under the new heading.

### 6. Run the build

The build stamps the plugin version into `server/version.json`, the version every board server reports, and regenerates the generated guide pages.

```sh
node scripts/build.mjs
```

### 7. Commit

Stage and commit by explicit path, after the maintainer's signature and its `Valid` check when step 4 applied. When step 4 applied, add `assets/askerdo-tray.exe` to both lists; when step 3 ran, add `tray/Cargo.toml`, `tray/Cargo.lock` and `assets/licenses/askerdo-tray.txt` too. The message body names what ships (the task ids) and the suite count.

```sh
git add -- .claude-plugin/plugin.json .claude-plugin/marketplace.json CHANGELOG.md server/version.json && git commit -m "release: <x.y.z>" -- .claude-plugin/plugin.json .claude-plugin/marketplace.json CHANGELOG.md server/version.json
```

## Verify

The checks, run locally (the repo has no CI since 2026-10-22):

```sh
node scripts/run-tests.mjs
node scripts/build.mjs --check
node scripts/check-tray-signed.mjs
claude plugin validate .
claude plugin test .
git log -1 --format=%s
```

- expect: `node scripts/run-tests.mjs` exits 0.
- expect: `node scripts/build.mjs --check` exits 0 (`server/version.json` says `<x.y.z>`, `docs/guide/reply-rules.md` matches the contract builder, and `docs/guide/cli.md` matches the CLI's help).
- expect: `node scripts/check-tray-signed.mjs` exits 0 (the committed tray exe carries a Valid signature), before anything is pushed. Step 4 already read the signature before the commit, so a refusal here means the release commit lacks the signed bytes: commit them before the push.
- expect: `claude plugin validate .` reports no error.
- expect: `claude plugin test .` passes on the desktop app's own `claude.exe` by path (the engine the mod runs on; the `claude` on PATH only when it is the same version; no pinned build; the run-tests procedure, step 5).
- expect: the last commit's subject is `release: <x.y.z>`.

## References

- `.claude-plugin/plugin.json`: the version installs compare.
- `.claude-plugin/marketplace.json`: the plugin entry's version, kept equal.
- `test/manifests.test.mjs`: pins the two versions equal.
- `CHANGELOG.md`: the Unreleased section that becomes the release section.
- `scripts/build.mjs`: stamps the version into `server/version.json` and writes the generated guide pages; `--check` compares.
- `server/version.json`: the version every board server reports.
- `tray/src/`: a change here since the last release means the crate moves.
- `tray/Cargo.toml`: the crate version, bumped only with a rebuilt exe.
- `tray/Cargo.lock`: records the crate version, so it moves with it.
- `tray/rust-toolchain.toml`: the pinned toolchain the exe is built with.
- `scripts/build-tray.mjs`: rebuilds `assets/askerdo-tray.exe` and its notices.
- `scripts/check-tray-signed.mjs`: refuses an unsigned or uncommitted tray exe.
- `scripts/run-tests.mjs`: the suite, run with the seam unset and a throwaway home.
- `assets/askerdo-tray.exe`: the committed tray binary.
- `assets/licenses/askerdo-tray.txt`: the tray's derived license notices, rewritten by the rebuild.
