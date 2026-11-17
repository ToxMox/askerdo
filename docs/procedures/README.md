# Procedures: the file shape

A procedure is a recurring operation written down once, as exact steps, beside the code it operates on. Every project keeps its procedures in `docs/procedures/<name>.md`, in the one shape below. This README is the contract the board's procedure parser reads: the headings, the frontmatter keys and the way triggers and paths are written are all load-bearing. A file that breaks a MUST below is reported as unparseable and gets no card.

The file holds only what is true of the code. The living part (last verified commit, run history, staleness and its reason) lives on the board card (`PR-n`) and is never written into the file, so a run never makes a commit.

## Where the files live

- Path: `docs/procedures/<name>.md` at the root of the repo that owns the operation. `<name>` MUST match `[a-z0-9]+(-[a-z0-9]+)*` and is the procedure's key within that repo.
- `README.md` and any file whose name starts with `_` (for example `_template.md`) are not procedures and are never parsed as one.
- One operation, one file. An operation that touches other repos still lives in one file, in the repo that drives it, and names the others through `repos` (below).

## Frontmatter

YAML between two `---` lines at the very start of the file. These keys and no others; an unknown key is a parse error, so a typo never silently drops a trigger. Quote any value that contains `: ` or ` #`, or starts with a backtick, quote, `[`, `{`, `*`, `&` or `!`; unquoted, YAML reads it as structure or fails.

```yaml
---
name: release
title: Cut an AskerDo release
summary: "Bump both manifests, date the changelog, run the build, commit `release: x.y.z`."
triggers:
  words: [release, cut a release, version bump]
  commands: ['commit -m "release:']
  files:
    - .claude-plugin/plugin.json
    - glob: '**/*.csproj'
      contains: PackageReference
repos:
  site: C:/src/example-site
---
```

| Key | Required | Meaning |
|-|-|-|
| `name` | yes | Equals the file name without `.md`. |
| `title` | yes | Imperative, one line; also the file's only H1. |
| `summary` | yes | One line, at most 200 characters; the card's description. |
| `triggers` | yes | A map with any of `words`, `commands`, `files`; at least one list is non-empty. |
| `triggers.words` | no | Lowercase phrases. `/proc <words>` and the board search match a procedure when every query word occurs in one phrase or in the title. |
| `triggers.commands` | no | Command fragments, matched case-insensitively while the session's working directory is inside a covered repo (in any project for an `everywhere` card), against what a Bash or PowerShell command runs: commands split at `&&`, `\|\|`, `;`, `\|` and line ends outside quotes, comments, heredoc bodies and here-strings aside. One bare word names a program: `docker` matches a command whose program is docker (past `VAR=x` and `sudo`), or that runs a script of that name (`node scripts/docker.mjs`). One word with a dot or slash names a file the command runs, found inside one argument and never inside a quoted phrase: `bump-version.ps1`, not a whole command line. A command runs the file when the file is its program (`./bump-version.ps1`) or an argument of a program that runs scripts (such as node, npx, tsx, deno, bun, python, py, flutter, dart, a shell or PowerShell outside `-c`, `gh workflow run`); a command that only names the file (`git add`, `git commit`, `cp`, `rm`) never matches it. One flag (`--dry-run`) or one environment setting (`APP_TONES=on`, or a name in capitals such as `APP_DRY_RUN`) matches a command other than git that runs with it: the flag among its arguments (`--dry-run` or `--dry-run=1`), the setting before its program (`APP_DRY_RUN=1 node serve.js`), set earlier in the same call (`export`, `set`, `$env:APP_DRY_RUN = 1`), or as a flag value (`--define=APP_TONES=on`). Several words match word for word as consecutive words of one command, the first by program name. A command that only reads or prints text (`grep`, `rg`, `cat`, `sed -n`, `head`, `ls`, `echo`, `Select-String`, `Get-Content`, `git log`) never matches, whatever it names. |
| `triggers.files` | no | Each entry is a glob string, or a map `{glob, contains}`. Globs are repo-relative, forward slashes, `*` and `**` allowed, matched against the path of an Edit, Write or NotebookEdit. With `contains`, the edit's new text must also contain that literal string. A path in another covered repo is written `<repo>:<glob>`. |
| `repos` | no | Other repos the steps touch: `<short name>: <absolute root on the machine that runs the procedure>`, forward slashes. The owning repo is implicit and never listed. The card's "repos covered" is the owning repo plus these. |
| `everywhere` | no | `true` makes a card for every project: its command triggers match in whatever project the session is in, and its file globs are relative to that project. Such a card lives only in the AskerDo plugin's own `docs/procedures` and is read from the installed plugin's folder, so one card serves every project and its pointer names the plugin's copy of the file. Its staleness is never judged (its files are not that project's) and a run moves no verified commit. It takes no `repos`. In any other repo the key gets the file no card, and the scan says so. Default `false`. |
| `live` | no | `true` marks a card for the live install: a command that sets AskerDo's seam (`ASKERDO_ROOT` or `ASKERDO_SANDBOX_HOME`) runs against a sandbox store and draws no pointer from it. Default `false`. |
| `record` | no | Who records a clean run. `command`: the card's one command is the whole run (a test run), so a command its trigger matched is recorded clean by the mod when it exits 0. `session`: the session records each run itself, with its report as the note when the steps say so; a command trigger that is one step of several never records the run. Default `session`. |

## Body: exactly these headings, in this order

After the frontmatter the body MUST be: one H1 equal to `title`, then these five H2 headings, spelled exactly, in this order, each present once, and no other H2:

```text
# <title>
## Trigger
## Preconditions
## Steps
## Verify
## References
```

### `## Trigger`

One to three lines of prose: the situation in which this procedure applies, in words a person would use. Not parsed beyond being present; the machine triggers are the frontmatter.

### `## Preconditions`

A bullet list, one condition per bullet, each something that can be checked before step 1. A bullet MAY end with ` check: ` and one backticked command whose output proves the condition, for example:

```markdown
- The working tree is clean. check: `git status --short` prints nothing.
```

An empty precondition list is written as a single bullet `- None.`

### `## Steps`

Only H3 children, written `### <n>. <imperative title>`, numbered from 1 with no gaps. Under each step: prose, and zero or more fenced code blocks.

- A fence tagged `sh` holds commands for a POSIX shell (the Bash tool); `powershell` holds commands for pwsh (the PowerShell tool). Every non-blank line in those fences that does not start with `#` is ONE command, run from the owning repo's root unless the prose says otherwise. Any other fence tag (`text`, `json`, `js`, `diff`, `markdown`) is content to read or write, never run.
- A placeholder is written `<lowercase-name>` in angle brackets (`<x.y.z>`, `<sha>`). It MUST be replaced before running; the parser skips placeholders when it checks commands.
- A step that is an edit says so, names the file in backticks, and names the symbol or heading it changes.
- Paths are repo-relative with forward slashes, in backticks. A path in another covered repo is written `<repo>:<path>`.

### `## Verify`

How to tell the procedure worked: prose, at least one `sh` or `powershell` fence, and one or more bullets starting `- expect: ` that state the observable result (an exit code, a line of output, a file's content). A run is clean only when every expect holds.

### `## References`

A bullet list. Each bullet starts with exactly one backticked target, then `: ` and why it matters. Targets:

| Form | Example | What the card does with it |
|-|-|-|
| Repo path (file, or folder ending `/`) | `` `lib/builder.js` `` | Staleness: changed since the verified commit, or gone. |
| Path plus symbol | `` `server/verbs/profile-rules.mjs::checkSetting` `` | As a path, and also "symbol gone" when the text after `::` no longer occurs in the file. |
| Other-repo path | `` `site:public/index.html` `` | As a path, in the named repo from `repos`. |
| Store record | `` `T-239` ``, `` `Q495` ``, `` `K-12` `` | A link on the card; no staleness. |
| URL | `` `https://...` `` | A link; no staleness. |

The References list is the authoritative set of paths for staleness. Every repo path that appears in backticks or inside a command in Steps or Verify MUST also appear here; the parser lints Steps and Verify for backticked tokens that contain `/` or end in a file extension and exist in the repo, and reports each one missing from References, except a path git ignores (a build's output). `askerdo proc scan --check` runs the parse, the lint and the staleness judge on the files of the checkout it runs in, a worktree's branch included, and writes nothing to the board.

## How the card judges staleness

From the file alone plus git, against the commit at which the procedure was last run clean (`PR-n`'s verified commit, per repo):

1. A referenced path changed: `git log --format=%H <verified>..HEAD -- <path>` is non-empty. The card names the path and links the diff.
2. A referenced path is gone at HEAD, or a `::symbol` no longer occurs in its file.
3. A command is gone: the first token of a command line is a repo path (for example `scripts/build.mjs`, or `node scripts/build.mjs`'s second token) that no longer exists, or a `--flag` used with a repo script no longer occurs anywhere in that script's source. A line is split on `&&`, `||`, `;` and `|` outside quotes and backticks, so a quoted regex stays one word. Commands on PATH (`node`, `git`, `claude`, `pwsh`, `curl.exe`) are taken as present: a first token with no slash that is not a file in the repo is one.
4. Age since the last clean run, shown second and never alone a reason.

## Recording runs

On a card with `record: command`, a command its trigger matched is recorded as a clean run when it exits 0, by the mod, with no call. Every other run a session records on the card: `/askerdo proc ran <name> clean`, or from a shell `askerdo proc ran <name> clean`. A clean run sets the verified commit to HEAD in each covered repo. A run that left the steps is recorded deviated, with a note and its outcome in the same call: `askerdo proc ran <name> deviated --note "what differed"` and one of `--fixed <commit>` (the steps are fixed now: the commit, in this checkout, that changed this file), `--one-off "why"` (the run was a one-off and the steps stand) or `--filed T-n` (real work the session filed through the ladder: an open task on a track or in an inbox). A deviated run with no outcome is refused and writes nothing, and the board files no task of its own. The note's first sentence names the step that differed and how, in its own words ("step 4 needed --force"); the card's journal keeps the whole note with its outcome, so a run report can follow it. A filed outcome flags the card with that sentence until the task closes, and a clean run leaves the flag while it is open. A one-off at a step whose last deviation was a one-off is refused: a deviation that recurs means the card should be fixed or the work filed. `askerdo proc drafts <name>` lists a card's deviated runs by step with the outcome each recorded, and the draft tasks filed before outcomes were said that are still open, for a session to settle. After a few clean runs the card suggests turning the steps into a script.

## Writing a new one

Copy `_template.md` to `docs/procedures/<name>.md`, fill every section, and keep the old home of the steps (a CLAUDE.md section or a knowledge record) as a one-line pointer to this file so the steps exist in exactly one place; Claude's auto memory is never their home.
