# Getting started

AskerDo makes Claude Code's replies glanceable and keeps what Claude needs from you on a board. This page takes one PC from install through configure and its board to your first answered question.

There are two routes, and both start the same way:

- **One PC.** Install the plugin and run `/askerdo:configure`; it sets up a board on this PC.
- **Several PCs, or a board that is always on.** The same install and configure, and at the board question pick the Docker board: configure walks the setup, on this PC or on another machine.

## What you need

- Claude Code 2.0.37 or newer for the output style. The band above the prompt, the AskerDo pane and the `/askerdo` command come from the plugin's mod, measured on Claude Code 2.1.299 and later; an older release was not measured, so expect only the output style, the skills and the hooks there.
- Node.js on the plain `PATH` (any recent LTS): the hooks, skills and CLI all run with `node`. A board on this PC needs Node 24 or later here; a Docker board brings its own Node.
- git, and a network path to GitHub: the marketplace add clones the public `ToxMox/askerdo` repository.
- For a Docker board: Docker with its engine running, on this PC or on the machine that will run the board.

## 1. Install the plugin

From a terminal:

```sh
claude plugin marketplace add ToxMox/askerdo
claude plugin install askerdo@askerdo
```

Open a new Claude Code session. Until you configure it, AskerDo writes nothing: the session start only tells Claude to offer the setup.

## 2. Configure your replies

In the session, run:

```text
/askerdo:configure
```

Claude interviews you in a few batched questions:

|You choose|What it sets|
|-|-|
|Eleven reply features|Each on or off: the weather and forecast icons on line one, progress lists, the capability docs, the fold, decision tables, diff blocks, the dash ban, diagrams and charts, widgets and forms, numbers that carry their names.|
|Pop-up questions|When Claude may use the pop-up question dialog: only for blockers, freely, or never (a hook enforces never).|
|Your own rules|Lines of your own, added to the contract word for word.|
|Command alias|An optional second name for `/askerdo`, such as `/ad`.|

Already set up on another PC in text mode? Paste that PC's `config.json` when configure starts and it copies the options instead of interviewing you. A PC joining a board you already run goes to the join first: the join brings your options from the board, and the interview follows only if you want something changed.

What it writes:

- `~/.claude/output-styles/askerdo.md`: the reply contract, generated from your answers. AskerDo owns this file and rewrites it whole whenever your options or the plugin version change.
- `"outputStyle": "askerdo"` in `~/.claude/settings.json`, after a backup copy is taken (`settings.json.bak`, or the next free `.bak1` when one is already there; the install line names it). Every other setting there stays as it was.
- Your options, in `config.json` in the plugin's data folder.

## 3. Pick a board

A board is AskerDo's own server: it holds your questions, tracks, handoffs and profiles, and hands out labels like `Q12`. Configure asks one question with three answers, and runs every step of the one you pick:

|Answer|For|What configure does|
|-|-|-|
|**A board on this PC**|You use AskerDo on this PC alone. The pick unless you say you use more than one PC.|Checks this Node can host a board (Node 24 or later), asks where the daily copies go (beside the database, or a folder you name, such as one a sync service copies off this PC), and runs `askerdo board here`. The board listens on `127.0.0.1`, so it answers only this PC, and this PC's local server keeps it running. [A board on this PC](board-setup.md#a-board-on-this-pc) has the details.|
|**A Docker board**, on this PC or another machine|One board for several PCs. The pick when you say you use more than one.|On this PC: checks Docker's engine runs and the port is free, confirms the time zone, builds the board's image from the plugin folder, starts the container `askerdo`, reads its setup code and joins this PC. On another machine: writes a kit folder you copy to the Docker host and start there with `docker compose up -d --build`, then takes the board's address and setup code from you and joins. [Run it with Docker](board-setup.md#run-it-with-docker) has the details.|
|**Join a board I have**|A board another PC or a server already runs.|Asks for the board's address and a code (the board's setup code for its first PC, a join code from a PC already on it for every later one) and joins. [Add a PC](add-a-pc.md) has the details.|

When this PC already holds options (you just answered the interview, or pasted them), configure first asks whether they go on the board for every PC that joins. On a yes they land on your profile on the board, but only when the board holds none yet: a board that already holds options keeps them, and this PC takes them.

Once the PC is on a board, configure runs the session-start sync, which writes the launcher `~/.claude/askerdo/cli.mjs` and starts this PC's local server (and, on Windows, the tray). Check it from a terminal:

```sh
node ~/.claude/askerdo/cli.mjs board
node ~/.claude/askerdo/cli.mjs list
node ~/.claude/askerdo/cli.mjs settings
```

`board` prints this PC's local server and, for a board on this PC, the board's address and the folder holding its database and backups; `list` reaches the board; `settings` lists your options as the board holds them.

On a board, configure also asks once how closely the board tracks reviews of finished code: `light` (the default) says on the band when a track's code waits for a review, `full` also holds a track's finish until a review has read it, and `off` leaves reviews out ([Review coverage](concepts.md#review-coverage)).

The style loads as a session starts, so it takes effect in your next session, or in this one after `/clear`. Configure also prints a shorter text for claude.ai's personal preferences, if you want the same habits in the chat apps.

To change one option later, use the Settings tab of the AskerDo pane (`/askerdo pane`, then Settings), or see [Settings and rules](settings-and-rules.md). To start with a board on this PC and move it onto a server later, see [Move to a server](board-setup.md#move-to-a-server).

## 4. Your first question

Every substantive reply opens with a line of up to three icons and a bold bottom line, and ends with what it needs from you:

```text
✅ 🌤️ 🙋 Webhook signature bug fixed and deployed; one retry-policy decision left.

...

🙋 Needs you:

Q106: how long should failed webhooks retry?

|type   |option             |what happens               |catch                      |
|106a ⭐|retry for 24h      |no event is lost           |failures surface slower    |
|106b   |drop after 3 tries |alerts fire within minutes |rare loss on long outages  |
```

The icons read left to right: what happened (done), how the work is going (minor bumps), whether you are needed (yes, now). The star marks Claude's pick.

A question is asked in full once and waits on the board. The band above the prompt shows it with one chip per option: press one and the strip under it answers (**Answer now**) or queues (**Queue answer**) with no model turn; with **Answer presses** at `once`, the chip answers at once. You can also type the token, `106a`, in your message, and an answer given from another session or PC reaches the asking session at its next prompt or step. [Daily use](daily-use.md#answering) lists every way to answer.

## Text mode: when there is no board

A board cannot run on this PC with a Node older than 24 (pick a Docker board or join one instead), and you can decline a board. Configure then sets the queue to `text` (the default) or `off`, and AskerDo keeps the reply contract and its settings without a board.

In text mode a question you leave open is written to `.claude/questions/<session-id>/` in the project, and each later reply ends with a linked line naming what is still open, instead of asking again: type `q` to see the open questions again as tables, a token such as `106b` to answer, or `drop Q106` to decline. Those files are working state, never committed: add `.claude/questions/` to your repo's `.gitignore` if they show up in `git status`. In `off` mode every reply restates what waits on you in its footer.

What text mode lacks:

|With a board|In text mode|
|-|-|
|Your reply options on your profile, the same on every PC|Options in this PC's `config.json`; another PC copies them from a pasted `config.json`|
|Open questions on the band above the prompt, with answer chips, answered from any session or PC|Files per project and session, answered by typing in that session|
|Handoff notes when a session's context runs deep, at the marks your profile sets|None; the context and usage meters on the status line still show|
|Workstreams, tracks, tasks, handoffs and `/askerdo resume`|None|
|Rules in force on every prompt and every agent brief, from your profiles and rule lines|Your own rules, in the contract only|
|The agent depth guard, `/askerdo guard on`|None|
|Knowledge and decision records, procedure cards|None|
|Web pages (overview, workstream graphs, search, settings), signed in with `askerdo login`|None|
|The tray icon with alerts, on Windows|None|
|Every `/askerdo` subcommand|`/askerdo pane`, which opens the pane and its Settings tab|

To leave text mode, run `/askerdo:configure` again and pick a board.

## Updating

```sh
claude plugin update askerdo@askerdo
```

Then start a new session. The update fetches the marketplace first, so this one command is the whole update (from a session's Bash tool, where `claude` may not be on the `PATH`: `"$CLAUDE_CODE_EXECPATH" plugin update askerdo@askerdo`). The new session rewrites the style and starts the local server from the new plugin folder. If the update says AskerDo is already at the latest version while a newer release is out, run `claude plugin marketplace update askerdo`, then the update again; a marketplace update alone leaves the installed plugin as it was.

Never remove the marketplace to update: a remove uninstalls the plugin. Your options and board join live in `~/.claude/askerdo/pc/` and a board on this PC in `~/.claude/askerdo/board-host/`, where no plugin command reaches them. A Docker board is rebuilt on its own: see [Upgrade](board-setup.md#upgrade).

For updates with no command, turn on the Claude app's auto-update for AskerDo: `/askerdo:configure` offers it once on each PC, and `askerdo settings set pluginUpdates on` (or the Settings tab's Plugin auto-update row) turns it on later. It sets the switch that `/plugin` shows under Marketplaces, which the desktop app has no panel for: `"autoUpdate": true` on the `askerdo` entry in `~/.claude/plugins/known_marketplaces.json`, and on the `askerdo` entry under `extraKnownMarketplaces` in `~/.claude/settings.json` when that entry is there. Claude Code then fetches a new release in the background as a session starts, and the next session runs it. `askerdo status` says whether it is on.

## Where to go next

- [Daily use](daily-use.md): the band, the status line, the pane and every `/askerdo` command.
- [Concepts](concepts.md): questions, workstreams, tracks, handoffs, profiles and the rest, and why you would use each.
- [Set up a board](board-setup.md): a board on this PC with its backups, or a board in Docker, and moving between them.
- [Add a PC](add-a-pc.md): join a PC to your board with a code.
- [Onboard a project](onboarding.md): move a project's old notes, TODO lists and decision logs onto the board.
- [Reply rules](reply-rules.md): every rule of the reply contract, with an example of each.
- [Settings and rules](settings-and-rules.md): every setting and where its value comes from.
- [CLI reference](cli.md): every verb.
