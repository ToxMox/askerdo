# Troubleshooting

What to check when AskerDo stops answering the way it should: the board is offline or will not start, a backup, restore or move went wrong, alerts stopped, a track belongs to another session, or this PC's local server is stuck. Every fix starts from a log; the table at the end says where each one lives.

The commands below use the launcher every PC on a board has, `node ~/.claude/askerdo/cli.mjs`. Setting up is covered in [Set up a board](board-setup.md) and [Add a PC](add-a-pc.md).

## The board is offline

**What you see.** The band and the Tracks tab say `Board offline: drawn from this PC's last copy`; a CLI read ends with `the board is offline: this read came from this PC's cache`; a write fails with `the board at http://<server>:17480 is unreachable (ECONNREFUSED)`.

Reads keep working from this PC's cache. Writes are never queued: a refused write did nothing, so run it again once the board is back. One message is different: `it may have run, so it was not sent again; check before trying again` means the write left this PC and no answer came back. Read the record first, then decide.

**What to run.**

1. From the PC, ask the board directly, at the address in `boardUrl` in this PC's `config.json` (`http://127.0.0.1:<port>` for a board on this PC):

   ```sh
   curl -s <board address>/health
   ```

   An answer like `{"ok":true,"protocol":1,"seq":4182,"version":"0.8.10"}` means the board is up and the trouble is between it and this PC: check the address, the network, or a firewall on the server.

2. No answer: look where the board runs. A board on this PC: see [The board on this PC does not start](#the-board-on-this-pc-does-not-start). A Docker board: on its host, look at the container.

   ```sh
   docker ps -a --filter name=askerdo
   docker logs --tail 50 askerdo
   ```

   A stopped container starts with `docker start askerdo`. An error at start (a schema migration, a disk full, a database it cannot open) is in the log; the [restore steps](board-setup.md#restore-a-backup) bring back the last good copy.

3. The board is up and this PC still says offline: the local server keeps retrying its event stream on its own. `node ~/.claude/askerdo/cli.mjs board` shows it is running; `~/.claude/askerdo/log` has a `local board: offline: <why>` line, and `local board: online` once it reconnects.

**Other refusals from the board.**

|Message|Cause|Fix|
|-|-|-|
|`the board does not know this token (revoked or never issued)`|This PC's token was revoked or replaced (a `token new` for the same device name revokes the old one).|Rejoin: on another PC on the board, `join-code --device <this PC's name>`, then here `node ~/.claude/askerdo/cli.mjs join http://<server>:17480 <code>`, which writes the new token over the old one. Configure offers a join only to a PC with no token saved, so it skips this one. With no other PC on the board, mint a fresh token with `token new <this PC's name>` on the box and save it here with `join http://<server>:17480 --token <token>`.|
|`this PC speaks protocol 1, the board speaks 2: update the plugin`|The plugin and the board are on different releases.|Update the side the message names: the plugin on this PC, or the [board](board-setup.md#upgrade).|
|`board not configured: join this PC with a code ...`|This PC has no board address saved.|[Add a PC](add-a-pc.md).|

## The board on this PC

A board on this PC runs as a child of this PC's local server, from the folder `~/.claude/askerdo/board-host/`: its database `askerdo.db`, `backups/`, `host.json` with its port, and `board.log`. How to set one up, back it up, restore it and move it is in [A board on this PC](board-setup.md#a-board-on-this-pc); this section is for when one of those goes wrong.

### `board here` refuses

`askerdo board here` (what configure runs for a board on this PC) checks two things before it writes anything:

|Message|Cause|Fix|
|-|-|-|
|`this PC is already on the board at <address>, so it hosts no second one`|This PC's `config.json` (or `ASKERDO_BOARD_URL`) already names a board.|Nothing to fix: this PC uses that board. To host one here instead, [take this PC off its board](add-a-pc.md#take-a-pc-off-the-board) first.|
|`the board needs Node 24 or later, for node:sqlite, and this PC runs Node <version>: the board cannot run here, and the text queue stays as it is`|The board's database needs `node:sqlite`, which Node 24 brought.|Install Node 24 or later on the plain `PATH` and run it again, or pick a Docker board or join one you have ([Pick a board](getting-started.md#3-pick-a-board)). Declining both leaves [text mode](#node-older-than-24-text-mode).|

Past those two, a run that stops part way keeps what it made, and `board here` run again picks up the same database and port:

|Message|Cause|Fix|
|-|-|-|
|`... this PC's local server, which starts the board, did not come up: <why>; askerdo board here again once it runs`|The board's files are made, but the local server that runs it is not up.|See [A stuck local server](#a-stuck-local-server), then `board here` again.|
|`the board did not answer on http://127.0.0.1:<port> within 15s: its log is <folder>/board.log; ...`|The board started and stopped, or is slow to open its database.|Read `board.log` (below), then `board here` again.|
|`the board database at <file> did not take a token: <why>`|Making this PC's token in the new database failed.|The reason follows; `board here` again once it is fixed.|

### The board on this PC does not start

`node ~/.claude/askerdo/cli.mjs board` says so: `this PC hosts the board at http://127.0.0.1:<port> (not answering: its log is <folder>/board.log)`. The local server starts the board within a second of its own start, and starts it again whenever it exits: after 1 second, then twice as long each time, up to a minute. So a board that stays down keeps failing, or is held stopped on purpose. Read, in order:

1. **`~/.claude/askerdo/board-host/board.log`**, the board server's own output: a database it cannot open, a disk full, a schema migration that failed. A Node older than 24 on the local server's `PATH` stops it here too, since the board runs on the same Node.
2. **`~/.claude/askerdo/log`**, the local server's `board host:` lines:

   |Line|Meaning|
   |-|-|
   |`board host: started the board on 127.0.0.1:<port> (pid <n>, database <file>)`|It started.|
   |`board host: the board exited (<code>); starting it again in <n>s`|It keeps failing: `board.log` says why.|
   |`board host: port <port> answers, but not a board this server started; it is left as it is`|Another program, or a board started by hand, holds the port. Stop it; the local server tries again on its own.|
   |`board host: held stopped for a restore` or `for a move to <address>`|A restore is running, or a [move is under way](#a-move-left-half-done).|
   |`board host: the board did not start: <why>`|The process could not be started.|

3. **No local server, no board.** The board stops with its local server, so a stuck local server is the board's trouble too: see [A stuck local server](#a-stuck-local-server).

### Backups

The first session start of each day copies the board into its backups folder and keeps the newest 30. Each copy logs a line in `~/.claude/askerdo/log`:

```text
board backup: <folder>/askerdo-2026-11-03.db (3604480 bytes; the newest 30 kept in <folder>)
```

A failed copy logs `board backup failed, and the next session start tries again: <why>` and leaves the day open, so the next session start, that day or later, tries again; nothing else is held up. The usual cause is a backups folder that is not there at the moment: a NAS share not mounted, a sync folder signed out. Bring the folder back, or go back to the folder beside the database and take a copy at once:

```sh
node ~/.claude/askerdo/cli.mjs settings unset boardBackups
node ~/.claude/askerdo/cli.mjs backup
```

Copies the board makes before a schema change always stay beside the database, in `board-host/backups/`, whatever the setting says. On a PC whose board runs elsewhere, `backup` is refused and names the command to run on the board's host; a [Docker board](board-setup.md#backups-export-and-the-integrity-check) keeps its own copies. The `boardBackups` setting itself is in [Settings and rules](settings-and-rules.md#this-pc).

### Restore

`askerdo restore` with nothing after it lists the copies in both folders, newest first; `askerdo restore <date or file>` puts one back. It holds the board stopped, folds the write-ahead log into the live database so that file alone holds every write, moves it (with any `-wal` and `-shm` left) into `board-host/before-restore/<stamp>/`, copies the copy in, and runs the integrity and foreign key checks:

|It says|What happened|Next|
|-|-|-|
|`restored <copy> as <database>; it passed the integrity check, and the files it replaced are kept in <folder>`|The board runs on the copy. Every PC on it starts over from the copy on its own; changes made after the copy are gone.|To go back, restore the kept file: `askerdo restore <folder>/askerdo.db`.|
|`<copy> failed the integrity check (...), so the board kept its own files`|The copy is damaged. The old files were put back; nothing changed.|Try an older copy.|
|`no copy dated <day> in <folders>`|No copy has that date.|`askerdo restore` lists what there is.|
|`the board on this PC is held stopped for a move to <address>, so it takes no restore now`|A move is under way.|Finish it or cancel it ([below](#a-move-left-half-done)).|
|`the board on <address> did not stop, so nothing was restored`|The running board would not stop.|Its `board.log`, then try again.|

Each answer ends by saying whether the board answers again. A restore that crashes part way never keeps the board down: its hold lapses with its process. The steps are in [Restore](board-setup.md#restore); a Docker board's are in [Restore a backup](board-setup.md#restore-a-backup).

### A move left half done

`askerdo board move <new address>` takes two runs ([Move to a server](board-setup.md#move-to-a-server)). Between them the board on this PC is held stopped on purpose, so nothing is written after the copy, and the hold lasts across restarts. While it holds, sessions on this PC read from the cache, their writes fail, and `~/.claude/askerdo/log` has `board host: held stopped for a move to <address>`.

- **To finish:** restore the copy the first run printed on the new board, start it, and run `board move <new address>` again. Run before the new board answers with this PC's token, it prints the same copy and steps again. `the board at <address> answers with this PC's token but holds an older copy` means the new board runs on something older than that copy: restore it there, then run the move again.
- **To give up:** `node ~/.claude/askerdo/cli.mjs board move --cancel` drops the move and starts the board here again (`the move to <address> is dropped; the board on this PC answers again at ...`). `no move is under way on this PC` means there is nothing to drop.

Once the second run succeeds, this PC is on the new board, the board here no longer starts (`host.json` becomes `moved.json`), and its folder stays as it was. A later `board here` starts on a fresh database and sets the moved one aside in `board-host/moved/<stamp>/`.

### Node older than 24: text mode

Only a board run with Node needs Node 24: the hooks, skills and CLI on a PC run on any recent LTS, and a PC joined to a Docker board or another PC's board runs on whatever Node it has. When no board can be had, or you decline one, configure leaves the PC in text mode: questions wait in a file per project under `.claude/questions/`, and you answer by typing the token in chat. Text mode has no band answer chips, no tracks or handoffs, no profiles and no rules in force. Run `/askerdo:configure` again after installing Node 24, or once there is a board to join, to put the PC on one.

## Notifications stopped

Alerts on Windows go through the tray's popup. They pass four gates in order, and the first that holds drops the alert: notifications switched off, a pause, quiet hours, then that kind of alert switched off.

1. **A pause.** Right click the tray icon: the menu reads `Paused until 15:40` (or `until I resume`) while a pause holds. Choose **Pause notifications**, then **Resume now**. A timed pause lapses on its own.
2. **The settings page.** The tray's **Notification settings** opens it. Without the tray, take the address `board` prints and add `notifications`:

   ```sh
   node ~/.claude/askerdo/cli.mjs board
   ```

   ```text
   board running at http://askerdo.localhost:17435/<secret>/
   ```

   Open `http://askerdo.localhost:17435/<secret>/notifications`. The page shows the master switch, quiet hours, the pause, and each kind of alert with its switch and sound. Its test button sends a card that skips every gate, which tells a gate apart from a broken popup.
3. **No tray icon.** The tray runs only while the local server runs. If you chose **Exit** in its menu, it stays away until the local server next starts (`~/.claude/askerdo/log` says `tray: the tray was exited by the person`): restart the local server (below). A log line `tray: no exe at <path>` means the plugin's `assets/askerdo-tray.exe` is missing; reinstall the plugin.

The settings live in `~/.claude/askerdo/board/notify.json`; `pausedUntil` is the pause. On macOS and Linux there is no tray and every alert is dropped with one log line (`notify: unavailable on this platform`).

## A track another session holds

A track is held by one session at a time. Resuming one that another session holds tells you who holds it and since when (`TR-12 is held by a session on <device> (took it today 09:12, last active 11:40)`) and changes nothing until you choose a move:

|Move|Command|What happens|
|-|-|-|
|Take it over|`/askerdo resume TR-12 --take-over`|This session holds the track; the other session is told at its next prompt.|
|Splinter|`/askerdo resume TR-12 --splinter "<name>"`|A new side track starts from it, held by this session; the reply says whether the original was parked behind it.|
|Read only|`/askerdo resume TR-12 --read-only`|The kickoff, to read; nothing is held.|

A holder that has done nothing on the track for 12 hours reads `quiet since <time>` on the shelf, and the shelf's resume for it is the take-over. Take over a live holder only when that session is gone or you mean to move the work: both sessions writing the same track's handoff is what the hold prevents.

## A stuck local server

Each PC's local server serves the CLI, the mod and the tray. Start it, or see why it will not start:

```sh
node ~/.claude/askerdo/cli.mjs board
```

|It says|Meaning|Fix|
|-|-|-|
|`board running at ...`|It answers and runs this plugin version.|Nothing to fix here.|
|`board started at ...` or `board replaced at ...`|It was down, or an older version was running, and a fresh one started: on Windows through the scheduled task, on macOS and Linux as a detached process.|Nothing to fix.|
|`port <n> is held by another process`|Another program listens on this PC's AskerDo port (in `~/.claude/askerdo/board/port`).|Stop that program. Or delete `~/.claude/askerdo/board/` so a new port and secret are picked; links minted before then stop working.|
|`a live update holds the board until it finishes`|A plugin update is swapping files.|Wait; the hold lapses on its own.|
|`the scheduled task "AskerDo board" could not be registered` or `could not be run`|`schtasks` refused; its own words follow.|Check the task: `schtasks /query /tn "AskerDo board"`. Run it by hand: `schtasks /run /tn "AskerDo board"`.|
|`the server did not answer within 3000ms`|The task ran, but no server came up.|Most often Node is missing from the `PATH` a logon task sees: `where.exe node` should name the installer's `node.exe`, not a version manager's. Then `board` again.|

**It answers but misbehaves** (the band stays stale, answers stop arriving): stop it through its own route, then start it again.

```sh
port=$(cat ~/.claude/askerdo/board/port)
secret=$(cat ~/.claude/askerdo/board/secret)
curl -s -X POST "http://127.0.0.1:$port/$secret/stop"
node ~/.claude/askerdo/cli.mjs board
```

In PowerShell:

```powershell
$port = (Get-Content ~/.claude/askerdo/board/port -Raw).Trim()
$secret = (Get-Content ~/.claude/askerdo/board/secret -Raw).Trim()
curl.exe -s -X POST "http://127.0.0.1:$port/$secret/stop"
node ~/.claude/askerdo/cli.mjs board
```

The stop closes the tray and every stream first, and stops a board this PC hosts with it. The next `board` (or the next session start, or the mod's next command) starts a fresh one on the same port, so links keep working, and that one starts the board again within a second.

On macOS and Linux, `board` and the session start launch the local server as a detached process instead of a scheduled task; that path has no measured run.

## Where the logs are

|Log|Where|What writes it|Read it with|
|-|-|-|-|
|The PC's log|`~/.claude/askerdo/log`|The local server (online, offline, restored, tray and alert lines, and `board host:` lines for a board on this PC), the session-start ensure (`board ensure: ...`), the daily copy (`board backup: ...`), the notifier|Any text viewer; newest at the end|
|The sync log|`sync.log` in the plugin's data folder (`~/.claude/plugins/data/askerdo-askerdo/` or its sibling holding `config.json`)|The session-start sync: the output style, the launcher, settings|Any text viewer|
|Local call timings|`~/.claude/askerdo/board/timings-local.log`|The local server, per call|`node ~/.claude/askerdo/cli.mjs timings`, which also shows the board's timings and its last integrity check|
|The tray's state|`~/.claude/askerdo/board/tray.json`|The local server, for each tray it starts|For diagnosis only|
|A board on this PC: its output|`~/.claude/askerdo/board-host/board.log`|The board server the local server runs|Any text viewer; `node ~/.claude/askerdo/cli.mjs board` names it when the board does not answer|
|A board on this PC: timings and checks|`timings.log` and `checks.log` in `~/.claude/askerdo/board-host/`|The board, per verb; each integrity check, a restore's included|Any text viewer|
|A Docker board: its output|the container's log|The board server|`docker logs askerdo`|
|A Docker board's timings|`/data/timings.log` in the container|The board, per verb|`docker exec askerdo node /app/server/cli.mjs timings`|
|A Docker board's integrity checks|`/data/checks.log` in the container|Each `check` run|`docker exec askerdo node /app/server/cli.mjs check` runs a new one|
