---
name: join-a-pc
title: Join a PC to the AskerDo board
summary: A fresh Windows PC installs AskerDo from ToxMox/askerdo, joins the board through configure (its token and options) and maps its repos.
everywhere: true
live: true
triggers:
  words: [join a pc, add a pc, new pc, second pc, join the board, join code, set up askerdo]
  commands:
    - cli.mjs join-code
    - cli.mjs join
    - askerdo.mjs join
    - marketplace add toxmox/askerdo
---

# Join a PC to the AskerDo board

**First prompt.** You paste this into a fresh Claude desktop session on the new PC:

```text
Set up AskerDo on this PC with me. In the Bash tool, run:
"${CLAUDE_CODE_EXECPATH:-claude}" plugin marketplace add ToxMox/askerdo
The add clones the public repo over https with git's prompts off. If it fails, show me the error and retry the add when I say the network or git is fixed.
If git itself is missing: winget install --id Git.Git -e, restart the Claude app, and paste this prompt into a new session.
Then read ~/.claude/plugins/marketplaces/askerdo/docs/procedures/join-a-pc.md and follow it with me from step 1, noting anything that differs from the card.
```

## Trigger

A Windows PC with no AskerDo joins your board: one board for every machine and the plugin in every session. A fresh desktop session follows this card from the first prompt above.

## Preconditions

- The board answers on the network and another PC (the main PC below) is already on it, to mint the join code. check: `curl.exe -s <board-address>/health`
- The board image runs the join release (0.8.5 or later): an older board has no join routes. check: `curl.exe -s -X POST -H "x-askerdo-protocol: 1" <board-address>/api/v1/join` refuses the missing device name, not "no route".
- The main PC runs the join release too, since it mints the code: there, `node "$HOME/.claude/askerdo/cli.mjs" help join-code` prints the verb.
- This card is on the board, so step 8's `proc ran join-a-pc` resolves: a `proc scan` in any project on a PC already on the board makes the plugin's cards for every project, this one among them. On the main PC, `node "$HOME/.claude/askerdo/cli.mjs" proc find join a pc` names it.
- The new PC runs the Claude desktop app, signed in, with git installed (the marketplace is a git clone).

## Steps

### 1. Check the tools

Node and git on the plain PATH, GitHub reachable over https (the public repo ToxMox/askerdo), the board on the network and the Claude CLI. Node 24 is the safe floor: the board image runs it. The board's scheduled task starts `node.exe` from the PATH a logon task gets, so a node that only a shell profile adds (a version manager's per-shell folder) never reaches it: `where.exe` should name the installer's `node.exe`. In the Bash tool `CLAUDE_CODE_EXECPATH` names the desktop app's own `claude.exe`, the engine its sessions run, so every Claude CLI command here is written `"${CLAUDE_CODE_EXECPATH:-claude}"`. Ask the user for the board address (`http://<board-host>:17480` on the default port, the board host's name or network address) for the last line.

```sh
node --version
where.exe node
git --version
GIT_TERMINAL_PROMPT=0 git ls-remote https://github.com/ToxMox/askerdo.git HEAD
"${CLAUDE_CODE_EXECPATH:-claude}" --version
curl.exe -s <board-address>/health
```

What the user fixes in PowerShell 7: a missing or old Node, and a missing git. When `ls-remote` is refused, GitHub is out of reach from this PC: a proxy or firewall, not a sign-in, since the repo is public.

```powershell
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Git.Git -e
```

### 2. Turn AskerDo on

The first prompt added the marketplace: its clone is `~/.claude/plugins/marketplaces/askerdo`, at ToxMox/askerdo's main branch, which is the release. Add it if the list lacks it (`https://github.com/ToxMox/askerdo.git` adds the same marketplace where the shorthand is refused), then install at user scope.

```sh
"${CLAUDE_CODE_EXECPATH:-claude}" plugin marketplace list
"${CLAUDE_CODE_EXECPATH:-claude}" plugin install askerdo@askerdo
"${CLAUDE_CODE_EXECPATH:-claude}" plugin list
```

`plugin list` shows `askerdo@askerdo` enabled. A later release reaches this PC with `plugin update askerdo@askerdo`, which fetches the marketplace first, then a new session. Never remove the marketplace to update: the remove uninstalls the plugin.

### 3. Start a new session

A plugin's hooks, skills and mod load when a session starts, so this session cannot run AskerDo. Fill in the notes so far (anything that differed), show the user the line below in a fenced block, and stop. The user opens a new session in any folder and pastes it. Its start says AskerDo is installed but not configured.

```text
Carry on with ~/.claude/plugins/marketplaces/askerdo/docs/procedures/join-a-pc.md from step 4, with me, and note anything that differs from the card. Notes so far: <notes>
```

### 4. Join the board through configure

Run the configure skill (`/askerdo:configure`) and tell it this PC goes on the board: it joins first, and the join brings the user's options from their profile on the board (the one held on `default`), so this PC matches every other at once. The interview follows only for a change, or when the join says the board holds no options yet; a later change goes through the pane's Settings tab.

The join: configure asks for the board address and a join code. Only then does the user mint the code on the main PC (the line below, or the tray's Add a PC and its Mint a code), since it expires in ten minutes; it prints the board address and the code. This PC's board name is its host name; for another, configure's join passes `--device <name>`. A name already on the board is refused, the main PC's own included, so the main PC is never cut off: pick another. Only a code minted with `join-code --device <name>` takes a name already on the board, and it replaces that device's token (a rejoin of a reinstalled PC), so it never names the main PC.

```powershell
node "$HOME/.claude/askerdo/cli.mjs" join-code
```

Configure saves the board address, this PC's own token, the hub queue and the options from the profile, and runs the sync again. Check the saved options without printing the token:

```sh
node -e "const c=require(require('os').homedir()+'/.claude/askerdo/pc/config.json');console.log(c.queue, c.boardUrl, c.boardToken ? 'token saved' : 'no token')"
```

### 5. Check the board from here

Configure's last sync wrote the launcher and started this PC's local server, its tray and the AskerDo board task. `board` starts or adopts the local server and prints its address; `list` reads the board through it. When either fails, the store's `~/.claude/askerdo/log` and the data folder's `sync.log` say why.

```sh
node ~/.claude/askerdo/cli.mjs board
node ~/.claude/askerdo/cli.mjs list
```

### 6. Map the projects

A file link naming another PC's folder opens here only once this PC's map has that project's folder. Each session start adds the project it opens in; a scan adds the rest now. Ask the user where their repos live and scan each folder.

```sh
node ~/.claude/askerdo/cli.mjs projects scan <folder>
node ~/.claude/askerdo/cli.mjs projects
```

### 7. Ask the user to look

Only the user sees the app. They open a new session in one of the mapped repos: the AskerDo band sits above the prompt, the status line shows, and replies come in the AskerDo shape (the output style loads at session start).

### 8. Record the run

The run teaches the card: record it clean, or deviated with a note whose first sentence names the step that differed and how (the card's flag and draft edit carry that sentence alone). Anything in AskerDo that tripped the run becomes a task labelled field-bug on the workstream that builds AskerDo, when the board has one (what happened, the cause, a fix), and this card is corrected in the AskerDo repo for the next PC.

```sh
node ~/.claude/askerdo/cli.mjs proc ran join-a-pc clean --note "<notes>"
node ~/.claude/askerdo/cli.mjs proc ran join-a-pc deviated --note "<step-that-differed-and-how>. <notes>"
echo '{"name":"<one-line-fault>","workstream":"<ws-n>","labels":["field-bug"],"description":"<what-happened-the-cause-a-fix>"}' | node ~/.claude/askerdo/cli.mjs task create --unplaced "found by a join-a-pc run"
```

## Verify

```sh
node ~/.claude/askerdo/cli.mjs board
node ~/.claude/askerdo/cli.mjs list
```

- expect: `board` prints the local server's address, running or started.
- expect: `list` answers from the board, with no refusal and no "board not configured".
- expect: the user sees the band and the status line in a new session.

## References

- `skills/configure/SKILL.md`: step 4 runs it: the join, which brings the options from the profile, then the interview for a change.
- `hooks/sync.mjs::hubMain`: hub mode writes the launcher and starts the local server, the tray and the task.
- `lib/node-helpers.mjs::DEFAULT_CONFIG`: the options and the board fields configure and the join save.
- `lib/cli-commands.mjs`: the join, join-code, board, list, projects scan, proc ran and task create verbs.
- `lib/board-ensure.mjs`: the board task step 5 checks.
- `lib/project-map.mjs`: the map step 6 fills.
- `.claude-plugin/marketplace.json`: the marketplace name, which names the clone folder.
