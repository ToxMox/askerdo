# Set up a board

The board is AskerDo's own server: one Node process and one SQLite file that hold every question, workstream, task, track, handoff, profile and record for all your PCs, and that alone hands out labels like `Q12` and `T-40`. You run one board for every machine you use.

`/askerdo:configure` sets up each of the three ways to run it, with no file to edit by hand ([Pick a board](getting-started.md#3-pick-a-board)). This page says what each one does, and holds the commands for running it by hand, backing it up, restoring it and upgrading it. To put a PC on a board that already runs, see [Add a PC](add-a-pc.md); when something stops working, see [Troubleshooting](troubleshooting.md).

|Where the board runs|For|Who reaches it|Kept running by|Where its data lives|
|-|-|-|-|-|
|[This PC](#a-board-on-this-pc)|One PC|This PC only (`127.0.0.1`)|This PC's local server|`~/.claude/askerdo/board-host/`|
|[Docker on this PC](#run-it-with-docker)|Several PCs, with this PC as the server|Every PC on your network|Docker (`restart: unless-stopped`)|The Docker volumes `askerdo-data` and `askerdo-backups`|
|[Docker on another machine](#a-docker-host-without-claude-code)|Several PCs, with a home server, NAS or VM as the server|Every PC on your network|Docker on that machine|`data/` and `backups/` in the kit folder there|

A board on this PC moves onto a server later with [`askerdo board move`](#move-to-a-server), so starting on one PC costs nothing if you add a second.

## A board on this PC

The board runs beside Claude Code, from the plugin folder, and listens on `127.0.0.1`, so only this PC reaches it. Configure's **A board on this PC** answer runs:

```sh
node <plugin>/bin/askerdo.mjs board here
```

`<plugin>` is the installed plugin's folder, under `~/.claude/plugins/cache/askerdo/askerdo/<version>/`. Add `--seed` to put this PC's saved reply options on the new board (configure asks first). The command creates the database, mints this PC's device token, has this PC's local server start the board, waits for it to answer, and saves its address, the token and the hub queue in this PC's `config.json`, keeping every other option. From then on the launcher runs every command: `node ~/.claude/askerdo/cli.mjs`, written `askerdo` below.

It refuses, writing nothing, when:

|Refusal|Why|
|-|-|
|`this PC is already on the board at <url>, so it hosts no second one`|`config.json` (or `ASKERDO_BOARD_URL`) already names a board. A PC is on one board at a time.|
|`the board needs Node 24 or later, for node:sqlite, and this PC runs Node <version>: the board cannot run here, and the text queue stays as it is`|The board's database needs `node:sqlite`. Update Node, or pick a Docker board or a join.|

A run that stopped part way (the board did not answer within 15 seconds, say) picks up the database and port it left when you run it again; its message names the board's log. Since only this PC reaches the board, `join-code` refuses here and names `board move`: a second PC joins once the board is [on a server](#move-to-a-server). After a move, `board here` starts a new board on a fresh database and sets the moved one aside in `board-host/moved/<stamp>/`.

Everything the board keeps is under the AskerDo store folder, outside the plugin folder, which an update replaces:

|Path under `~/.claude/askerdo/board-host/`|What|
|-|-|
|`askerdo.db` (plus `-wal`, `-shm`)|Every record.|
|`backups/`|The daily copies, unless `boardBackups` names another folder, and the copy taken before a schema change, always.|
|`host.json`|The board's port and database file. The port is `17480`, or one the OS picks when that is taken, chosen once and kept, since every link names it.|
|`board.log`|The board server's own output.|
|`before-restore/<stamp>/`|The files a restore replaced.|

`askerdo board` adds a line for it: `this PC hosts the board at http://127.0.0.1:<port>; its database and backups are in <folder>`, or `not answering: its log is <board.log>`.

**How it starts and restarts.** This PC's local server (the small server every PC on a board runs, [What the PC runs](add-a-pc.md#what-the-pc-runs)) starts the board as its own child whenever `host.json` is there, checks on it every second, and starts it again when it exits, after one second and then doubling to at most a minute. When the local server stops, the board stops with it. After a plugin update the new local server starts the board from the new plugin folder, on the same database.

|Platform|What starts the local server, and so the board|
|-|-|
|Windows|The `AskerDo board` scheduled task, at logon and at each session start, outside any Claude session.|
|macOS, Linux|Each session start, which starts the local server detached when it does not answer and logs `board: started the local server detached (pid <n>)` to `~/.claude/askerdo/log`. Nothing starts it at login, so the board comes up with the first session after a restart. Not measured on either system.|

### Backups

The first session start of each day copies the board, keeping the newest 30 dated copies (`askerdo-YYYY-MM-DD.db`), and logs `board backup: <file>` to `~/.claude/askerdo/log`. A copy that fails is logged, and the next session start tries again. To take one now:

```sh
node ~/.claude/askerdo/cli.mjs backup
```

The copies go beside the database by default. To keep them off this PC, point the per-PC setting `boardBackups` at a folder that a sync service or a NAS share carries (configure asks during setup; the Settings tab edits it too):

```sh
node ~/.claude/askerdo/cli.mjs settings set boardBackups "D:/Sync/AskerDo backups"
node ~/.claude/askerdo/cli.mjs settings unset boardBackups
```

It takes a full path, creates the folder, and refuses one this PC cannot write. `unset` goes back to beside the database. The copy a schema change takes always stays beside the database, so a board whose folder is offline still starts.

### Restore

```sh
node ~/.claude/askerdo/cli.mjs restore
node ~/.claude/askerdo/cli.mjs restore 2026-11-01
```

With no copy named it lists the copies in both folders, newest first. Given a date (that day's copy) or a file, it stops the board, folds the write-ahead log into the live database so that file alone holds every write, moves it (with any `-wal` and `-shm` left) into `before-restore/<stamp>/`, copies the backup in, and runs SQLite's integrity and foreign key checks. A copy that fails them is taken out and the old files go back. Then it starts the board again and waits until this PC's local server reaches it. Changes made after the copy are gone.

### Move to a server

When you add PCs, move the board onto a Docker or Node server with its records. Set up the new board first ([Run it with Docker](#run-it-with-docker) or [A Docker host without Claude Code](#a-docker-host-without-claude-code)) and leave it with no PC joined. The move takes two runs:

1. Start it:

   ```sh
   node ~/.claude/askerdo/cli.mjs board move http://<server>:17480
   ```

   This stops the board on this PC and holds it stopped, so nothing is written after the copy it makes now, then prints that copy's path and the steps for the server. While the move is held, sessions on this PC have no board and read from its cache.

2. Copy the file to the server and restore it into the new board with that board stopped. On a Docker board:

   ```sh
   docker stop askerdo
   docker run --rm -v askerdo-data:/data -v <folder holding the copy>:/from askerdo-board node /app/server/cli.mjs restore /from/<the copy's name>
   docker start askerdo
   ```

   On a kit host, mount the kit's `./data` in place of `askerdo-data`; without Docker, run `node server/cli.mjs restore <the copy>` with the `ASKERDO_DB` the board runs on.

3. Run the same `board move` line again. Once the new board answers with this PC's token and holds at least the copy's last change, it points this PC at the new board (keeping its token), stops the board here for good and renames `host.json` to `moved.json`. The old folder stays where it was.

`askerdo board move --cancel` drops a move begun here and starts the board on this PC again. Other PCs then join the new board with a code from `askerdo join-code` ([Add a PC](add-a-pc.md)).

## Run it with Docker

A Docker board serves every PC on your network. Configure's **A Docker board** answer, on this PC, runs the plugin's own `compose.yaml`, which builds the board's image from the plugin folder (there is no published image) and starts it:

```sh
ASKERDO_PORT=17480 ASKERDO_TZ=Europe/Berlin docker compose -f <plugin>/compose.yaml up -d --build
```

In PowerShell, set the two variables first:

```powershell
$env:ASKERDO_PORT = '17480'; $env:ASKERDO_TZ = 'Europe/Berlin'; docker compose -f <plugin>/compose.yaml up -d --build
```

|Variable|Default|What it does|
|-|-|-|
|`ASKERDO_PORT`|`17480`|The port the board listens on, inside the container and on the host. Every PC uses it in the board address.|
|`ASKERDO_TZ`|`UTC`|The board's time zone, an IANA name such as `America/Chicago`: every stamp it writes and every day boundary (a backup's date, a snooze until tomorrow) falls in it. Configure offers this PC's.|

The container is `askerdo`, the image `askerdo-board`, and it restarts with Docker. The database and backups live on the named volumes `askerdo-data` and `askerdo-backups`, inside Docker's own storage, so they outlive the plugin folder an update replaces. A rebuild after a plugin update is the same line, with the same port and zone: without them it falls back to `17480` and `UTC`.

Configure joins this PC at its network name (`http://<this PC's name>:<port>`), the address `join-code` and the tray's Add a PC print for the next PC, and saves the container's name as the `boardContainer` setting. The first session start of each day then backs the board up inside the container, as `docker exec askerdo node /app/server/cli.mjs backup` does, into the `askerdo-backups` volume with the newest 30 kept, and logs `docker board backup: <file>` to `~/.claude/askerdo/log`. A day Docker or the container is not running goes without a copy, with a line in the log saying so. For a board you started by hand, `node ~/.claude/askerdo/cli.mjs settings set boardContainer askerdo` turns the daily copy on, and `settings unset boardContainer` turns it off.

On its first start the server creates `/data/askerdo.db` and brings its schema up to date. Check it answers from another machine:

```sh
curl -s http://<server>:17480/health
```

```json
{"ok":true,"protocol":1,"seq":0,"version":"0.8.10"}
```

`seq` is the number of the last change on the board; it grows with every write. `version` is the AskerDo release the board runs. The image's own health check calls the same route every minute, so `docker ps` shows the container as `healthy`.

|The board needs|Detail|
|-|-|
|A machine that stays on|This PC while you use AskerDo, or any host that runs Docker (a home server, a NAS, a small VM). The board is light: one process, one file.|
|Node 24 in the image|The image is `node:24.14.0-slim` plus the plugin's `server/` folder. `node:sqlite` is built into Node 24, so there is no `npm install` and no native module.|
|One TCP port|`17480` by default, reached by every PC.|
|A trusted network|The board speaks plain HTTP and each PC sends its own device token. Keep it on your home or office network, or put a TLS reverse proxy in front of it; a PC accepts an `https://` board address.|

Keep `/data` on a local disk. SQLite runs in WAL mode and wants a real filesystem: never a network share or a FUSE union path.

### What the image sets

|Variable|Default|What it does|
|-|-|-|
|`TZ`|`UTC`|The time zone (`ASKERDO_TZ` sets it through the compose file). Node carries its own zone data, so the slim image needs nothing else.|
|`ASKERDO_DB`|`/data/askerdo.db`|The database file. Its folder also holds `archive/`, `timings.log` and `checks.log`.|
|`ASKERDO_BACKUPS`|`/backups`|Where `backup` writes its dated copies and where a schema change leaves its copy first.|
|`ASKERDO_PORT`|`17480`|The port the server listens on inside the container.|
|`ASKERDO_HOST`|`0.0.0.0`|The address it listens on inside the container.|
|`ASKERDO_ARCHIVE`|`archive/` beside the database|Not set by the image: with no value the server uses the `archive/` folder next to `ASKERDO_DB`. An optional folder of older files the board's web pages serve under `/archive`; set it only to serve another folder.|

### Without compose

The same board with plain Docker, from the plugin folder (or a kit folder): build an image, then run it on the same named volumes, so a board started this way moves to the compose file with its data.

```sh
cd <plugin>
docker build -f server/Dockerfile -t askerdo-board:1 .
docker run -d --name askerdo \
  -p 17480:17480 \
  -v askerdo-data:/data \
  -v askerdo-backups:/backups \
  -e TZ=Europe/Berlin \
  --restart unless-stopped \
  --stop-timeout 10 \
  askerdo-board:1
```

In PowerShell, a backtick ends each continued line in place of `\`:

```powershell
docker run -d --name askerdo `
  -p 17480:17480 `
  -v askerdo-data:/data `
  -v askerdo-backups:/backups `
  -e TZ=Europe/Berlin `
  --restart unless-stopped `
  --stop-timeout 10 `
  askerdo-board:1
```

Tag each build (`:1`, `:2`, or the release number) so an upgrade can go back to the image before it. To publish the board on another host port, change only the left side of `-p` (`-p 18080:17480`); every PC then uses that port in its board address.

## The first PC

A board starts with no devices. The first PC joins with the board's setup code; every later PC joins with a code that a PC already on the board mints ([Add a PC](add-a-pc.md)). On configure's Docker paths this is done for you: on this PC it reads the code itself, and for another machine it asks you for it.

1. Read the setup code from the board's log. While no PC is on the board, each start prints one:

   ```sh
   docker logs askerdo
   ```

   ```text
   askerdo board listening on 0.0.0.0:17480
   setup code: <the setup code>
   ```

   On a kit host, `docker compose logs board` in the kit folder shows the same. The code works until the first PC joins, however long that takes, and only the board's console shows it. A restart replaces it, and `docker exec askerdo node /app/server/cli.mjs setup-code` prints a fresh one. Once a PC is on the board, no setup code is printed or taken.

2. On that PC, run `/askerdo:configure`, answer **Join a board I have**, and give it the board address and the setup code. If the PC already holds options, configure asks whether they go on the board for every PC; say yes to put them there. Under the hood it runs:

   ```sh
   node <plugin>/bin/askerdo.mjs join http://<server>:17480 <the setup code> --seed
   ```

   A mistyped code saves nothing. The join saves the board address, this PC's token and the hub queue in the PC's `config.json`, keeping every other option, and never prints the token. With `--seed`, a board that holds no reply options yet takes this PC's: they land on your profile on `default`, the one every PC reads its options from (the seed makes it, named `personal`). A board that already holds options keeps them, and this PC takes them instead.

   The fallback, when the log cannot be read or the board already holds a device token (such a board prints no setup code): mint a token on the board's machine with `docker exec askerdo node /app/server/cli.mjs token new <device>` and join with it, `join http://<server>:17480 --token <the device token> --seed`. The join checks the token with the board before it saves anything.

3. Configure runs the session-start sync, which writes the launcher and starts the PC's local server (and, on Windows, the tray). Check the PC reaches the board:

   ```sh
   node ~/.claude/askerdo/cli.mjs list
   node ~/.claude/askerdo/cli.mjs settings
   ```

From here, add each further PC with a join code: `node ~/.claude/askerdo/cli.mjs join-code` on this PC, then [Add a PC](add-a-pc.md) on the new one.

## A Docker host without Claude Code

For a board on a home server, NAS or VM that runs Docker but not Claude Code, configure's **A Docker board** answer, on another machine, writes a kit: a folder holding the board's `server/` code, a `compose.yaml` with your port and zone written in, and a `README.txt`. By hand, from a PC with the plugin:

```sh
node <plugin>/server/cli.mjs kit ~/askerdo-board --port 17480 --tz Europe/Berlin
```

The folder must be new or empty. With no `--tz` the kit takes this PC's zone and says so; a zone Node does not know is refused. Then:

1. Copy the folder to a local disk of the Docker host: never a network share, nor a FUSE path such as Unraid's `/mnt/user`.
2. In that folder on the host, start the board and read its setup code:

   ```sh
   docker compose up -d --build
   docker compose logs board
   ```

3. On Unraid, give the folders to the appdata share's owner after the first start (Docker creates them owned by root):

   ```sh
   chown -R 99:100 data backups
   ```

4. Back on the PC, give configure the board's address (`http://<host>:<port>`) and the setup code; it checks the board answers and joins ([The first PC](#the-first-pc), step 2).

A kit keeps the database in `data/` and the backups in `backups/` beside its `compose.yaml`, as host folders, so you can see and copy them directly. The container is still `askerdo`, so every `docker exec askerdo` line on this page works there too.

## Tokens

One token is live per device. The commands run inside the container and reach the running server through its admin route, which answers only on loopback, so nothing outside the container can call it.

|Command|What it does|
|-|-|
|`docker exec askerdo node /app/server/cli.mjs token list`|Every device with when its token was made and, if so, revoked.|
|`docker exec askerdo node /app/server/cli.mjs token new <device>`|A new token for the device. It replaces the device's old one, which signs that device's browsers out and kills its live join code.|
|`docker exec askerdo node /app/server/cli.mjs token revoke <device>`|Takes the device off the board: its token, browser sign-ins, unused login links and live join code stop working, and its open event stream is closed.|

A lost or reinstalled PC rejoins with a code minted for its own name (`join-code --device <name>`), so `token new` is only for a PC with no other PC on the board to mint a code.

## Backups, export and the integrity check

A board on this PC copies itself daily ([Backups](#backups)), and so does a Docker board configure set up on this PC ([Run it with Docker](#run-it-with-docker)). A board on another host runs nothing on a clock: schedule these three on the host (cron, a NAS task scheduler, or any job runner); each one goes through the running server, so only the server ever opens the file:

```sh
# nightly: a dated copy in /backups, the newest 30 kept
docker exec askerdo node /app/server/cli.mjs backup
# weekly: every record as Markdown, readable without AskerDo
docker exec askerdo node /app/server/cli.mjs export /backups/export
# weekly: SQLite's integrity and foreign key checks; exits 1 when either fails
docker exec askerdo node /app/server/cli.mjs check
```

A cron table for the three, for example:

```text
15 3 * * *  docker exec askerdo node /app/server/cli.mjs backup
30 3 * * 0  docker exec askerdo node /app/server/cli.mjs export /backups/export
45 3 * * 0  docker exec askerdo node /app/server/cli.mjs check
```

|Command|Writes|
|-|-|
|`backup [--keep <n>]`|`/backups/askerdo-YYYY-MM-DD.db`, a complete copy made with `VACUUM INTO`; a second run on the same day replaces that day's copy. Older dated copies beyond `--keep` (30 by default) are deleted.|
|`export <folder>`|One Markdown file per record into the folder, which it needs: with no folder it refuses.|
|`check`|Prints the result and appends it to `/data/checks.log`.|

Keep `/backups` on different disks from `/data` where you can, and copy it off the machine with whatever backs up the rest of your server.

### Restore a backup

The server's `restore` puts a copy back with the board stopped: it folds the write-ahead log into the live database and moves it (with any `-wal` and `-shm` left) into `/data/before-restore/<stamp>/`, copies the backup in, and runs the integrity and foreign key checks, putting the old files back when the copy fails them. It refuses while a board answers on its port, but a throwaway container cannot see the running board, so stop it first. The board's volumes are mounted in a throwaway container from the board's own image:

1. List the copies (newest first), then stop the board:

   ```sh
   docker run --rm -v askerdo-data:/data -v askerdo-backups:/backups askerdo-board node /app/server/cli.mjs restore
   docker stop askerdo
   ```

2. Restore a day's copy (or name a file in `/backups`):

   ```sh
   docker run --rm -v askerdo-data:/data -v askerdo-backups:/backups askerdo-board node /app/server/cli.mjs restore 2026-11-01
   ```

3. Start the board: `docker start askerdo`, then `curl -s http://<server>:17480/health`.

Use your own image tag (such as `askerdo-board:1`) for a board started with `docker run`. On a kit host, mount the kit's folders instead (`-v "$PWD/data:/data" -v "$PWD/backups:/backups"`, from the kit folder) and stop and start with `docker compose stop board` and `docker compose start board`. On Unraid, mount the app's data and backup folders (the table under [On Unraid](#on-unraid)). Without Docker, `node server/cli.mjs restore` runs on the `ASKERDO_DB` and `ASKERDO_BACKUPS` the board uses.

Every PC picks the board up again on its own: its local server sees the board behind its saved place in the event stream and starts over from the board's (its log says `restored`). Changes made after the backup are gone from the board; no PC writes them back from its cache.

## Upgrade

The board and the plugin on your PCs speak a protocol version. When they differ, each call gets a plain message naming the side to update (`this PC speaks protocol 1, the board speaks 2: update the plugin`), never strange behaviour. Upgrade the board when a release says its server changed, and keep the PCs on the same release. A board on this PC needs nothing: the local server runs it from the plugin folder an update installs.

1. Take a backup: `docker exec askerdo node /app/server/cli.mjs backup`.
2. Rebuild from the new release:

   |How the board runs|Rebuild|
   |-|-|
   |Compose on this PC|Update the plugin, then run the compose line from [Run it with Docker](#run-it-with-docker) again from the new plugin folder, with the same `ASKERDO_PORT` and `ASKERDO_TZ`.|
   |A kit|Replace the kit's `server/` folder with the new release's (from the updated plugin folder, or a new kit), then `docker compose up -d --build` in the kit folder.|
   |`docker run`|Build a new tag from the new plugin folder (`docker build -f server/Dockerfile -t askerdo-board:2 .`), then `docker stop askerdo && docker rm askerdo` and the run line from [Without compose](#without-compose) with the new tag.|

On start the server migrates the database. When a release changes the schema, it first writes `askerdo-pre-schema-<n>-<date>.db` to `/backups`, so a failed upgrade goes back on that copy: restore it with the [steps above](#restore-a-backup), its file name in place of the date, and start the board from the release before.

To try an upgrade before your real board takes it, build the new release under a tag of its own and run it on another port, on a copy of a backup in volumes of its own:

```sh
docker build -f server/Dockerfile -t askerdo-board:try .
docker run --rm -v askerdo-backups:/backups -v askerdo-try:/data askerdo-board:try node /app/server/cli.mjs restore 2026-11-01
docker run -d --name askerdo-try -p 17481:17480 -v askerdo-try:/data -v askerdo-try-backups:/backups \
  -e TZ=Europe/Berlin askerdo-board:try
```

In PowerShell, end the continued line with a backtick in place of `\`.

Point a scratch config at `http://<server>:17481`, and when you are done remove it with `docker rm -f askerdo-try` and `docker volume rm askerdo-try askerdo-try-backups`.

## On Unraid

A kit runs on Unraid as on any Docker host ([A Docker host without Claude Code](#a-docker-host-without-claude-code)): put its folder on a pool path such as `/mnt/cache/appdata/askerdo-board`, never under `/mnt/user`, and run the `chown` line after the first start.

For a board that shows up on the Docker tab as an app with its icon and web link, use `server/unraid/install.sh` instead: it builds the image on the server, writes a Docker tab template for it and creates the container the way the Docker tab's Apply does. A kit folder carries the script.

1. Write a kit and copy it to the server, for example to `/mnt/cache/appdata/askerdo-src`.
2. In a root shell on the server, from that folder, install the first time with `--new`, which lets the script start an empty board:

   ```sh
   cd /mnt/cache/appdata/askerdo-src
   ASKERDO_TZ=Europe/Berlin bash server/unraid/install.sh --new
   ```

3. Read the setup code for the first PC (step 1 of [The first PC](#the-first-pc)) with the app's name: `docker logs AskerDo`.
4. Schedule the upkeep (the User Scripts plugin or cron), with `AskerDo` as the container name.

What the script sets up:

|Setting|Default|Change it with|
|-|-|-|
|Container and app name|`AskerDo`|fixed|
|Host port|`17480`|`ASKERDO_PORT`|
|Board data (`/data`)|`/mnt/cache/appdata/askerdo`|`ASKERDO_DATA_DIR`|
|Backups (`/backups`)|`/mnt/user/backups/askerdo`|`ASKERDO_BACKUP_DIR`|
|Time zone (`TZ`)|`UTC`|`ASKERDO_TZ`, or the app's Time zone field in the Docker tab (advanced view)|
|Runs as|user 99, group 100 (`nobody:users`), restart unless stopped|fixed|
|Autostart|on, so the board starts with the array|the Docker tab|

Keep the data folder on a pool path such as `/mnt/cache/...`, never under `/mnt/user`: SQLite on Unraid's FUSE layer is not safe. Without `--new`, the script stops when the data folder holds no `askerdo.db`, so a mistyped path never starts an empty board beside your real one. A restore mounts the two folders in the table, and uses the image the script built (`docker images askerdo-board` lists it).

**Upgrade on Unraid.** Copy the new release's `server/` folder over the source folder's and run the script again with no flags. A rerun keeps the port, folders and time zone the app's template holds (a variable you set wins), replaces the container and leaves the data alone. The Docker tab's own update check reads "not available" because the image is built locally; the script is the update.

**A staging board.** `bash server/unraid/install.sh --staging` makes a second app, `AskerDo-staging`, on port `17481` with its own folders (`/mnt/cache/appdata/askerdo-staging` by default) and autostart off. Copy a backup into its data folder as `askerdo.db` first, or pass `--new` as well for an empty one.

## Without Docker

The server is plain Node, so any host with Node 24 runs it from the plugin folder or a kit folder:

```sh
ASKERDO_DB=/srv/askerdo/askerdo.db ASKERDO_BACKUPS=/srv/askerdo-backups TZ=Europe/Berlin \
  node server/cli.mjs serve --host 0.0.0.0
```

In PowerShell:

```powershell
$env:ASKERDO_DB = 'D:/askerdo/askerdo.db'; $env:ASKERDO_BACKUPS = 'D:/askerdo-backups'; $env:TZ = 'Europe/Berlin'; node server/cli.mjs serve --host 0.0.0.0
```

Outside Docker the host defaults to `127.0.0.1` (this PC only), so `--host` or `ASKERDO_HOST` opens it to the network. Keep it running with your system's service manager. The upkeep commands are the same without the `docker exec askerdo` prefix: `node server/cli.mjs backup`, `node server/cli.mjs restore`, and so on, with the same `ASKERDO_DB`. `node server/cli.mjs help` lists every command.

## Where the board keeps things

|Path in the container|What|
|-|-|
|`/data/askerdo.db` (plus `-wal`, `-shm`)|Every record. Only the server opens it.|
|`/data/timings.log`|How long each verb took; `docker exec askerdo node /app/server/cli.mjs timings` sums it.|
|`/data/checks.log`|Each integrity check's result.|
|`/data/archive/`|Optional old files the web pages serve.|
|`/data/before-restore/<stamp>/`|The files a restore replaced.|
|`/backups/askerdo-YYYY-MM-DD.db`|The nightly copies.|
|`/backups/askerdo-pre-schema-*.db`|The copy taken before a schema change.|
|`/backups/export/`|The weekly Markdown export, if you scheduled it there.|

On a kit host, `/data` and `/backups` are the kit's `data/` and `backups/` folders; for a board on this PC, the [table above](#a-board-on-this-pc). The container's own output (`docker logs askerdo`) carries the start line, `askerdo board listening on 0.0.0.0:17480`, the setup code while no PC is on the board, and any error the server raises.
