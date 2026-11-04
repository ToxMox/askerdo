# Settings and rules

Settings shape how Claude replies to you, when a session hands off, how agents are guarded and what working rules every session and agent follows. This page says what each setting does, where its value comes from, and the three places to change one: the Settings tab, the board's settings page and the `settings` verb.

## Where a value comes from

Every setting has a built-in value. What overrides it depends on whether this PC is on a board, which `/askerdo:configure` sets up (a board on this PC, a Docker board, or one you already have: [Pick a board](getting-started.md#3-pick-a-board)).

**On a board**, values live in profiles: named sets of settings and rule lines, held on records. A profile can be held at five layers, widest first:

|Layer|Held on|Reaches|
|-|-|-|
|default|the board itself|every session on every PC|
|project|a project folder|its sessions on any PC (a project with a git remote travels by the remote; one without, only at that folder)|
|workstream|a WS-n|every track in it|
|track|a TR-n|that track alone|
|task|a T-n|that task alone|

For each setting the narrowest layer whose profiles set it wins; nothing set anywhere means the built-in value. A layer can also drop a profile held wider up, so it stops applying from there down.

A few values stay on this PC even on a board: the board link and token, which the join (or `board here`) sets, the queue, which is `hub` on a board PC, and the folder for the daily copies of a board this PC hosts. Your reply options sit on the profile held on default (a board with none gets one named `personal`), so every PC takes them at its next session start; `config.json` keeps a copy for an offline start.

Two built-in profiles, `guard-on` and `guard-off`, switch the agent guard for a project: `/askerdo guard on` puts one on the project you are in.

**In text mode**, the fallback for a PC with no board (where none can run, such as a Node older than 24 with no board elsewhere to join, or when you decline one), the reply options and the question queue live in this PC's `config.json`, and everything else stays at its built-in value, read only. Your own rules go in the `contract.custom` list.

## The settings

`askerdo settings` prints this list live, with each value and where it comes from.

### Replies

|Key|Label|Built in|
|-|-|-|
|`contract.weather`|Weather icon|on|
|`contract.forecast`|Forecast icon|on|
|`contract.tasks`|Progress lists|on|
|`contract.docs`|Capability docs|on|
|`contract.fold`|The fold|on|
|`contract.decision`|Decision tables|on|
|`contract.diff`|Diff blocks|on|
|`contract.emdash`|Dash ban|on|
|`contract.visual`|Diagrams and charts|on|
|`contract.interactive`|Widgets and forms|on|
|`contract.ids`|Numbers carry names|on|
|`contract.dlg`|Pop-up questions: `blockers`, `free` or `ban`|`blockers`|
|`contract.custom`|Your own rules, a list|none|
|`contract.alias`|Command alias for `/askerdo`|none|

On a board these are set at the default layer only.

### Sessions and agents

|Key|Label|Built in|What it does|
|-|-|-|-|
|`main.on`|Depth meter|on|The session watches how full its context is and says when to hand off|
|`main.window`|Handoff window|30 percent|Where the session starts looking for a clean point to hand off|
|`main.wrap`|Wrap line|40 percent|Where it finishes what is in flight, starts nothing new and writes its handoff|
|`agent.on`|Agent guard|off|Agents get a note to hand back when their context runs deep|
|`agent.soft`|Soft limit|350k tokens|Past this, an agent finishes its step and hands back|
|`agent.hard`|Hard floor|450k tokens|Past this, the note turns urgent|
|`agent.remind`|Reminder step|25k tokens|How often the note repeats past the soft limit|
|`agent.hardDeny`|Lock at the hard floor|off|Past the hard floor, the agent may write only its state note|
|`dispatch.inject`|Rules ride every brief|on|The rules in force go with every agent you dispatch|
|`dispatch.stateNote`|State notes|on|Each agent keeps a note of what is done and what is next|
|`dispatch.outputRule`|Short reports|on|Each agent's final report stays under 2000 characters|

### Tests

|Key|Label|Built in|Takes|
|-|-|-|-|
|`tests.policy`|How many tests|`few`|`few`, `standard`, `off`|
|`tests.fullRun`|Full test suite|`end`|`end`, `merge`, `never`|
|`tests.pinWording`|Exact wording in tests|off|on, off|

### This PC

|Key|Label|Built in|
|-|-|-|
|`queue`|Question queue: `hub`, `text` or `off`|`text`|
|`boardUrl`|Board link, set by the join|none|
|`boardToken`|Board token, set by the join and never shown|none|
|`boardBackups`|Board backups folder, for a board this PC hosts|empty: beside the database|
|`boardContainer`|Docker board container, for a Docker board on this PC|empty: none|
|`answerPresses`|Answer presses: `confirm` or `once`|`confirm`|

`boardBackups` is where the first session start of each day copies a board this PC hosts, keeping the newest 30. Empty means `~/.claude/askerdo/board-host/backups/`, beside the database; a folder in OneDrive, Dropbox or on a NAS share keeps the copies off this PC. It takes a full folder path, creates the folder, and refuses one this PC cannot write (`Board backups folder must be a folder this PC can write, and <folder> is not (<why>)`), writing nothing. `settings unset boardBackups` goes back to the folder beside the database. Copies the board makes before a schema change stay beside the database whatever this says, so a board whose folder is offline still starts. A PC whose board runs elsewhere makes no copies: the board's host keeps its own ([Backups, export and the integrity check](board-setup.md#backups-export-and-the-integrity-check)).

`answerPresses` says what pressing an option on a question card does. At `confirm`, the press opens a strip under the option with the note field, **Answer now**, **Queue answer** and **Cancel**; a queued answer stays on this PC, off the board, until **Send** records and delivers every queued answer together ([Queued answers](daily-use.md#queued-answers)). At `once`, the press records the answer straight away and the asking session hears it, as the band's chips always do. `askerdo settings set answerPresses once` writes this PC's `config.json`, board or not; the Settings tab's **This PC** sub-tab sets it too.

`boardContainer` names a Docker board on this PC; configure sets it to `askerdo` when it starts one. The first session start of each day then runs the board's own backup inside that container, into its backups volume, keeping the newest 30. A day Docker or the container is not running goes without a copy, with a line in the log. It takes a container name; `settings unset boardContainer` stops the copies.

## Rule lines

The rules in force are the working rules every session reads on each prompt and every agent gets with its brief (while `dispatch.inject` is on). They are built from:

1. The lines the test and dispatch settings write, such as the few-tests rule.
2. The built-in lines, each with a short name (a slug) such as `opus-workers` or `run-it-first`.
3. Rule lines of your own on your profiles.

A rule line is a slug, the rule in plain words (at most 400 characters), and who it is for: the session, its agents, or both. A narrower layer's line with the same slug replaces the wider one, and a drop switches a line off by its slug at that layer and below; dropping the drop brings it back. A line made from one of your rulings (`--from`) changes only with a newer ruling.

To see exactly what a session or agent gets for a record:

```sh
node ~/.claude/askerdo/cli.mjs profile show-effective TR-12 --rules
```

## When a change takes effect

|Setting|Takes effect|
|-|-|
|Reply options|Your next session, or this one after `/clear`: the save rewrites the output style at once. Your other PCs take it at their next session start.|
|Command alias|Your next session, or this one after `/clear`.|
|Depth and agent guard settings|Within seconds in every open session.|
|Test and dispatch settings, rule lines|From your next prompt in every open session, and in every agent dispatched after it.|
|Board link and token|When this PC joins a board.|
|Board backups folder|The next copy: `askerdo backup`, or the first session start of the next day.|
|Docker board container|The first session start of the next day.|

## Changing a setting

### The Settings tab

Open the AskerDo pane with `/askerdo pane` and pick Settings. It works on a board and in text mode.

- Six sub-tabs, Replies, Sessions, Agents, Tests, Rules and This PC, each with one line saying what is in force there and how many settings you changed.
- Each setting shows its label, one line on what it does, its control and a scope chip saying where its value comes from: built-in, everywhere, this project, this workstream, this track only, this task only, or this PC.
- A fold under each setting holds what changes, an example, when it takes effect and the CLI command for it.
- On a board, a picker chooses the layer a change is written at, and Remove from this layer takes a value off so the next layer down applies.
- The Rules sub-tab adds a rule line (a name, the rule, and who it is for), removes one, and brings back a built-in line you dropped.
- Changed only filters to the settings you changed.

A refused value says why in the setting's own words and writes nothing.

### The board's settings page

On a board, the same settings are a web page at `/settings` on your board, after `askerdo login` signs your browser in. Chips at the top choose where you are setting: Everywhere (your default profile), a project, a workstream or one of its tracks. Every control is a plain form, so it works with scripts off. A reply option saved there reaches each PC at its next session start, `/clear` included; the other settings take effect as the table above says.

### The settings verb

```sh
node ~/.claude/askerdo/cli.mjs settings
node ~/.claude/askerdo/cli.mjs settings set main.window 25
node ~/.claude/askerdo/cli.mjs settings set contract.forecast off
node ~/.claude/askerdo/cli.mjs settings set tests.fullRun merge TR-12 --at track
node ~/.claude/askerdo/cli.mjs settings unset main.window
node ~/.claude/askerdo/cli.mjs settings rule add no-force-push --text "Never force-push." --for agents
node ~/.claude/askerdo/cli.mjs settings rule drop opus-workers
```

- `settings set` writes into the profile that sets the value now, or your default profile when it is built in. `--at` picks a layer instead, with the record after the value: the profile held there that sets it, else the one held there, else a new one named `settings-<record>`.
- `settings unset` takes a value off the layer that sets it now, so the next layer down applies.
- `settings rule add` and `drop` work on your default profile, so they reach every session; `clear` takes a slug off a profile.
- `settings set boardBackups <folder>` and `settings unset boardBackups` write this PC's `config.json` alone, on any PC; the folder takes effect once this PC hosts the board. `boardContainer` is written the same way.
- In text mode, a reply option or the queue is written to `config.json`, and the output style is rewritten on the spot.

In text mode there is no `~/.claude/askerdo/cli.mjs`: change a setting in the Settings tab of the AskerDo pane (`/askerdo pane`, then Settings).

### Profiles by hand

The `profile` verbs work on named profiles directly:

```sh
node ~/.claude/askerdo/cli.mjs profile define quick-merge --set tests.fullRun=merge --set main.window=25
node ~/.claude/askerdo/cli.mjs profile add WS-16 quick-merge
node ~/.claude/askerdo/cli.mjs profile rule-add quick-merge small-commits --text "Commit at each green checkpoint."
node ~/.claude/askerdo/cli.mjs profile rule-drop quick-merge opus-workers
node ~/.claude/askerdo/cli.mjs profile show-effective TR-12
node ~/.claude/askerdo/cli.mjs profile list
node ~/.claude/askerdo/cli.mjs profile remove WS-16 quick-merge
```

A profile name is lowercase letters, digits and dashes, at most 40. `profile show-effective` prints each setting in force for a record with the profile and record it came from, and which records along the way hold or drop a profile.

## Related

- [Reply rules](reply-rules.md): every reply rule with an example, and which settings change which rules.
- [Getting started](getting-started.md): the first setup with `/askerdo:configure`.
- [Troubleshooting](troubleshooting.md#backups): a daily copy that failed, and where its log line is.
- [Concepts](concepts.md): workstreams, tracks, tasks and how profiles fit in.
- [CLI reference](cli.md): every `settings` and `profile` verb in full.
