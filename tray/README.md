# AskerDo tray

`askerdo-tray.exe` is the Windows tray application for the AskerDo
board: one small native process that owns the tray icon and its six faces,
three states across two taskbar themes, carries the menu and the tooltip that
says how many questions are blocking, draws every AskerDo alert as a card in
its own popup by the tray corner (the popup is the one alert surface, 
in every state and on every PC), and (the native file opener) is
the ONE opener for every file, folder and project a record links.

It replaces two things the board server used to spawn: a resident Windows
PowerShell 5.1 tray helper (measured at about 104 MB of working set and 16
threads) and a whole throwaway PowerShell process per toast, whose toasts wore
the header "Windows PowerShell" because that was the app identity they were
raised under. Neither of them stands
behind it either: they were not kept as a safety net, so an exe that cannot run
means no tray and no alert rather than a quieter second path.

The exe is a CLIENT of the board server on every path but one. It writes no
record, holds no state the server does not hand it on the wire, and reads no
store on any path the server spawns. The ONE path that reads the store is
`--open`, the Start Menu shortcut's own click, which has no server to be handed
anything by: it reads the two files of the store's board folder and nothing
else, and it writes nothing anywhere. The path that is not a client is
`--serve`, the scheduled task's action (the launcher), which is how
the board server is started at all: it is HANDED a store root and does not read
the store, or anything else, on its way to creating the server.

## Where the contract is

The wire between this exe and the board server is pinned by the crate's own
tests and `test/tray.test.mjs`: the argv, the events stream and its `tray`
payload, the `open` event and its three frame shapes, the ping fallback, the
liveness rule, the reconnect backoff, the pause the menu POSTs, the Recent
files click and the exit codes. Run both before changing anything here. The
`alert` event and its request are pinned in the popup section below, which is
where they live.

The header names: the stream attach sends `x-askerdo-tray: <instance>`, and a
server serving another instance answers `409`. The ping answers with
`x-askerdo-board` (the server's version), `x-askerdo-instance` and
`x-askerdo-dot`, which the exe reads.

Exit codes: `0` normal, `2` bad arguments, `3` `--register` or `--unregister` failed,
`4` a different server instance is serving the port, `5` the tray could not be
shown (the window or the shell's icon slot refused),
`6` the self-reap (two consecutive unanswered pings: the server is gone).
WHAT THE SERVER MAKES OF THEM: any exit BEFORE the stream attaches is a
failed start, logged in one line, and nothing is started again until the next
alert asks for a tray. After the attach, `0` is the person choosing Exit from
the menu, and that decision stands until the server restarts: an alert arriving
meanwhile is refused with a line rather than putting the icon back over it. `4`
is a replacement server taking the port, which is the exe standing down rather
than a decision, so no icon goes back up on its own, though the next alert that
asks for a tray starts one. Any OTHER ending after the attach is a crash, and
the server starts the exe again ONCE, never within 60000 ms of the last start.

`6` IS WHY THE REAP IS NOT `0`: a server stalled past two pings, about 75 s, is
not a person choosing Exit, and a server that then recovers would have read its
own reaped tray as a decision and refused every alert until its next start.
Under `--no-icon` there is no menu to choose Exit from at all, so that reading
could never have been the right one. The server takes `6` as the crash it is:
the tray goes back up once past the floor, or at the next alert that asks for
one.

ONE ENDING THE SERVER CANNOT ANSWER, said plainly: an exe that is RUNNING but
never attaches to the stream is not replaced. The attach-window kill that used
to retire such a process went with the fallback it opened, so each alert waits
its 500 ms, is answered 503, and is dropped, until the board server restarts.

`--no-icon` is the one argument the wire contract did not have at first: the
exe runs its stream, its popup and its stdin control channel with no
notification-area icon and no menu. It is what `board/notify.json`'s
`tray: false` means, because the alert channel and the icon are two
different things and only one of them was ever the expensive one; the switch
that starts no exe at all is `enabled: false`.

## The six faces, and the taskbar theme that picks between them

The art is not painted by this repo any more. (the icon package)
every mark here is a delivered file committed as delivered, with its
provenance, its exact colours and its measured validation beside it in
`assets/icons/README.md`, `assets/icons/manifest.json` and
`assets/icons/validation-report.json`. `assets/icons/export.mjs` and its
`package.json` are DOCUMENTATION of how the rasters were cut: they want a
dependency this repo will never install, and nothing here ever runs them.

SIX FACES, three states across two taskbar themes, because a single `.ico`
does not recolour itself with the Windows theme and the package draws the
check in two colours:

```
assets/tray-waiting.ico     assets/tray-light-waiting.ico
assets/tray-quiet.ico       assets/tray-light-quiet.ico
assets/tray-blocking.ico    assets/tray-light-blocking.ico
  cream check, DARK taskbar orange check, LIGHT taskbar
```

All six are compiled in by `include_bytes!` in `src/tray.rs` (`ART_DARK` and
`ART_LIGHT`, each in the `Dot` order waiting, quiet, blocking), so an install
that lost an asset cannot leave this tray blank. Each file is five classic
32 bit DIB frames, 16, 20, 24, 32 and 48 px, which is every size a Windows
tray asks for from 100 to 300 per cent: `icon::face` finds an EXACT frame at
all of them and resamples only above 48. The state is drawn as the mark's own
status marker, the same three the browser tab wears: a blue marker while
questions wait, an amber one while anything blocks work, and the hollow pink
ring when nothing is open.

WHICH SET IS WORN is read from the SYSTEM personalization setting and never
from the board's theme:
`HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`,
`SystemUsesLightTheme`. `AppsUseLightTheme` beside it is the setting for app
windows and says nothing about the taskbar, so it is never read; 1 is the
light set and anything else, a missing value included, is the dark one. It is
read once at start and again on every `WM_SETTINGCHANGE` whose lParam names
`ImmersiveColorSet`, the broadcast the shell sends when the light or dark
choice moves. That lParam read is bounded at 64 units, and a null or
unreadable one counts as a YES rather than a no: re-reading one registry value
costs nothing, and missing the one broadcast that matters would leave a cream
check on a white taskbar until the next restart. Measured 2026-09-08: writing
the setting alone switched nothing in ten seconds, because the exe answers the
broadcast rather than watching the key, and Settings sends the broadcast after
it writes.

NO COUNT ON THE ICON, at any size: the icon is the delivered frame and nothing
is painted over it, so the mark stays whole down to 16 px. The count of
blocking questions lives in the TOOLTIP (`AskerDo: 12 blocking`) and,, in the tray menu's own counts line, which says the waiting number beside
it; which state the board is in is what the marker the
package drew into every face says at a glance, amber blocking, blue waiting
and the hollow ring quiet.

THE CHECKER, `scripts/check-icons.mjs`, replaces `scripts/make-icon.mjs`,
which painted the old mark from code and rebuilt it to compare the bytes.
There is nothing to rebuild from any more, so the checker reads the manifest
and then the BYTES of every committed icon and pins what the package says each
one is: each `.ico`'s frame count, every frame's pixel size and its encoding
(a classic 40 byte header at 32 bits per pixel, or a PNG frame exactly where
the manifest says one, which is `app.ico`'s 256 alone), every committed PNG's
width, height, depth and colour type, and every favicon SVG's 64 unit viewBox.
It is stdlib only, it reads and never writes, and `test/icons.test.mjs` runs
it as a function, so a drift fails the suite rather than waiting for somebody
to run a script.

## The menu, and the state it is drawn from

Right click builds a FRESH popup every time, out of the state the exe is
holding at that instant, with no request of any kind on the path.  
(the tray menu) it carries, in this order: a greyed counts line (`3 blocking,
6 waiting`, `nothing waiting` when both are zero); the BLOCKING questions by
name, up to five, oldest first, each opening its own card; the WAITING
questions under a greyed `waiting` heading, up to five, newest first, each
opening its own card; `Open board`; `Activity`; `Add a PC`
(`--add-pc`), the local server's page that mints a join code for
another PC; `Notification settings`; each of those drawn only when the
server handed over its URL;
a `Pause notifications` parent that reads `Paused until 15:40` while a pause
holds, opening a submenu of `For 1 hour`, `Until 07:00 tomorrow`, `Until I
resume`, a separator and `Resume now`, greyed while nothing holds; and `Exit`.
A block with nothing in it is not drawn at all, heading and separator
included, so the menu never carries a gap where a question would be, and the
two blocks own fixed, disjoint command-id ranges, so which line a click names
never depends on how many blockers stood when the menu was built.

EVERY WORD AND EVERY URL IS IN A PURE MODEL, `menu_model`, which the unsafe
walker only appends: the vocabulary is unit tested line by line and the Win32
call site holds none of it, exactly as `tooltip` is written beside it. A line
is CUT FIRST at forty characters over the whole `<id> <name>` line, on
character boundaries, with three ASCII dots when it cut, and ESCAPED SECOND.
The card URLs are frozen into the model at build time and the click indexes
that frozen vector, never the live state: the network thread can replace the
lists while the menu sits open, and a click that read the live state would
open a card the reader never saw on a line that said something else.

THE MENU GOES STALE WHILE THE STREAM IS DOWN, AND THAT IS THE RULE RATHER
THAN A BUG. Every field the menu draws from arrives on the events stream, and
an ABSENT field leaves the last known value standing, which is the same rule
the dot and the tooltip's count have always had. The PING FALLBACK carries
none of them: its answer headers say the instance and the dot and nothing
else. So a long outage leaves the menu showing the last state the stream told
it, exactly as the tooltip's count already does, until the stream comes back
and the first frame corrects the whole thing at once. The one thing the exe
never does is invent a value: before the first frame of all, the counts line
reads `connecting` and no question line is drawn, because the spawn argv
carries a blocking count and nothing else.

THE AMPERSAND: a literal `&` in a menu label has to be written as TWO, or
Windows eats it as an access-key prefix, and no Microsoft menu page states
this for `AppendMenuW` (the nearest documented statement is `DrawText`'s
`DT_NOPREFIX`). So it was measured rather than assumed: with the doubling in
place a name carrying one ampersand rendered as ONE character with no
underline, read back from a screenshot of the open menu (2026-09-09),
and the model draws a 31 character line as 30 (2026-09-10). The cut runs
before the escape and never after: cutting a doubled pair in half would turn
a literal ampersand back into an access key.

THE RECENT FILES BLOCK joined the menu (the native file opener), above `Open board`: a greyed `recent files` heading, up to five
lines, newest first, each carrying the BASENAME alone rather than the
`<id> <name>` a question line carries, under the same forty-character cut
and the same ampersand doubling. It is not drawn at all when nothing has
been opened, heading and separator included, and not before the first
stream frame. The list arrives on the stream as `tray.recent`, an array of
`{ id, index, name }` and NEVER a path: the exe re-checks each entry
against the store's own id shapes and an index of 0 to 9999 on arrival,
caps at five again, and freezes the URLs into a vector of its own at menu
build time beside the cards'. A click POSTs `{"kind":"open"}` to
`<board>f/<id>/<index>/open` off a short-lived thread, in the pause POST's
exact shape, so this is the SECOND of the two places the exe writes
anything anywhere. TWO HOPS ON PURPOSE: the exe asks the board to open the
ref by record id and index, the board answers with an open frame down the
stream, and so the exe never holds a path it was not handed and the tray
menu and the board card take the identical code path.

NO LOCAL CLOCK LIVES HERE. The pause line prints the words the server sent
(`pauseLabel`), and choosing a submenu entry POSTs one verb to the board
server's notify route off a short-lived thread, so the message loop never
waits on the network; the answer's own `pausedUntil` and `pauseLabel` are
applied the way a stream frame is applied. Any failure is one journal line
and nothing else: no retry, no dialog, no balloon, because the server's next
frame is the correction.

## The opener: what `opener.rs` runs, and what it will never parse

(the native file opener) this exe
is the ONE opener for every file, folder and project a record links. A
click on the board POSTs a KIND to the board server by record id and list
position; the server resolves the position through that record's own refs
list, stats the target once, and writes ONE `open` frame down the same
events stream the alerts ride. `src/opener.rs` reads that frame and does
one thing per shape:

- a SHELL VERB ON A PATH (`open` for the default app and for a folder
  through the system folder handler): `ShellExecuteW`, with the return code
  journalled, since anything at or below 32 is an error code in a pointer's
  clothing;
- THE WINDOWS PICKER, the `openwith` kind alone: `ShellExecuteExW` with
  `SEE_MASK_INVOKEIDLIST` and `SEE_MASK_NOASYNC` (0x0000010C) and the
  `openas` verb;
- a URL THROUGH THE SHELL (an editor or project scheme, the Claude Code
  deep link): the same `ShellExecuteW('open', <url>)` the menu's own
  `Open board` makes, and its answer is journalled too;
- an EXE WITH AN ARGV ARRAY (a command-line editor template, or Windows
  Terminal at a folder): one `std::process::Command` over the array.

EVERY SHELL SHAPE RUNS ON A SHORT-LIVED STA THREAD OF ITS OWN, spawned per
frame, `CoInitializeEx(COINIT_APARTMENTTHREADED)` then one call then
`CoUninitialize`, which is `shortcut.rs`'s precedent. It is not an
optimisation: the network thread this frame arrives on is
`COINIT_MULTITHREADED` before the pump ever runs, so asking for an apartment
there only answers `RPC_E_CHANGED_MODE`, and the picker's route instantiates
a shell extension, which is the case `ShellExecuteW`'s own documentation says
wants an STA. The thread is detached, so a slow shell call cannot hold the
SSE pump either. `NOASYNC` is the documented flag for a caller with no
message loop that returns at once.

THE PICKER IS THE SHELL'S CONTEXT-MENU ROUTE and nothing falls back to the
plain call: `ShellExecuteW('openas', <file>)` answers 31 where no association
exists at all, which is exactly where the picker is wanted. The
mask and the verb are pinned BY VALUE in a crate test through `plan`, a pure
function from a frame to the `Call` it becomes, so the shape is read without
a shell or a desktop under it.

THE WINDOW AN OPEN STARTS COMES TO THE FRONT (reversing the build
contract's own prediction): every shape takes a list of the visible titled
top-level windows before its call and, for up to two seconds after it, calls
`SetForegroundWindow` on the first window that is new, because a folder open
answers no process to match a window by. None appears where the file manager
reuses a lister it already has, and one journal word says so; the plain call
is the one taken because the probe measured no candidate doing better.

THE TERMINAL'S FLAGS ARE THE SAME FLAGS, and a probe says they were never the
reason a terminal did not appear: under the flag word by value, with the
three standard handles NULL, `wt.exe -d <folder>` raised a window every time,
and so did every flag word with a bit taken out. `wt.exe` is a LAUNCHER that
exits within a fraction of a second, and where a terminal of the same package
is already running it starts no process of its own and opens a TAB in the
window that is already there.

THE ONE SENTENCE THAT MATTERS: the exe runs only what arrives on the frame,
and it will never parse a command line out of a path and never touch a path
the frame did not carry. It holds no template, no path table and no program
name of its own; it resolves nothing, reads no store on this path, writes
no file, registers nothing and never touches the icon. A frame that is not
JSON, that names no kind, that is not exactly one of the three shapes, or
that carries both a `url` and an `exe`, is ONE JOURNAL LINE AND NO CALL,
because two instructions are two instructions and this exe follows neither.
Nothing goes back up the wire either: the board's 200 promises the frame
was written to the tray and no more, and every outcome past that is a
journal line under `--log`.

THE CREATION FLAGS ARE `serve.rs`'S OWN, and so is the reason: this is a
`windows_subsystem = "windows"` image that owns no console, so a console
child would create one. `CREATE_NO_WINDOW | DETACHED_PROCESS |
CREATE_NEW_PROCESS_GROUP`, with `CREATE_NO_WINDOW` documented as ignored
beside the detach and named anyway, so a later change that drops the detach
cannot silently lose it. The value is pinned by a crate test beside
`serve.rs`'s own, asserting `CREATE_NEW_CONSOLE` is not set. THE NO-CONSOLE
RULE IS SCANNED, NOT TRUSTED: the test that no source file in `tray/src`
names the std process builder is SCOPED rather than deleted, to "no source
file OUTSIDE `opener.rs`", with the file count floor raised and a SECOND
scan asserting that every builder inside `opener.rs` sets the flags. The
needle is still assembled at run time, because the scanning file is one of
the files it reads. That second scan also counts `Stdio::null()` three times
per builder: a command child gets NO standard handles, so the board server's
control pipe to this exe can never land in an editor or a terminal, and a
`code.cmd` template that hung with the inherited handles starts VS Code with
them nulled. So there are two processes this exe ever creates and no third:
`--serve`'s `CreateProcessW` and this one.

WHAT THE EXE WILL NOT PASS ON: two const lists, the two verbs the server
sends (`open` and `openas`) and the seven kinds `lib/open-in.mjs` names, kept
equal to that file by hand. Anything else is one refusal sentence in the
journal before any shell call at all, so `runas` and its neighbours never
reach `ShellExecuteW`. The exe reads only its own server's stream, so this is
depth rather than a hole.

## The popup and the alert entry point

A mod's native notification answers
`no-surface` in the desktop app, so the tray is the mod's one native channel.
The exe draws its OWN popup near the tray (`src/popup.rs` the model, layout and
drawing; `src/alert.rs` the frame, the routing and the window). Each card,
top to bottom: a glyph per kind in the icon package's colours (Done and
Closed in a clean green) beside a
label line, the kind in words (Question, Blocking question, Handoff written,
Thread waiting and so on) and its age since it reached the tray, kept current
while it shows; what happened in bold, wrapped to two lines with an ellipsis
only past two; the context line in names (the sender's names, else its
`where`); for a question, "My pick: ..."; then one link for the obvious action
(the card, or the board when the alert names none), "open this card's files"
through the opener's own route, and a close mark. Cards grow to fit
their lines; a stack taller than the work area sends its oldest non-blocking
cards to the "+N more" line. At most three cards show, newest nearest the
tray, blockers first to claim a slot; the rest wait behind a "+N more" line
that opens the board. A blocker never leaves on its own; anything else leaves
8 s after it was first drawn, held while the pointer is over the popup. Every
card about a question, a blocker included, leaves outright once that question
is answered, dropped or snoozed anywhere. A right click on a card
dismisses it. A repeat of the same kind for the same
card replaces the older card. The stack sits at the primary work area's
corner; while the Claude desktop app's window is in front and covers that
corner, it stands above the app's own toast zone.

THE REQUEST, the one the mod's lanes call. `POST <board>api/alert`, where
`<board>` is `http://127.0.0.1:<port>/<secret>/` off the store's `board/port`
and `board/secret`, with a JSON body:

```
{
  "kind": "blocker",          required: question, blocker, answer, track, handoff,
                              done, dropped, closed, depth, info
  "title": "Q512 needs you",  required: one line, cut at 120 characters
  "where": "WS-11, T-307",    optional: one line, cut at 80
  "blocking": true,           optional: default true for blocker, false otherwise
  "card": "Q512",             optional: a record id (Q, WS, P, T, TR, TR-n.m, K), a path under the
                              board root (w/T-307), or a URL on this board
  "files": true,              optional: true for the card record's openable refs, or
                              a list of ref positions; at most five; needs a card
                              that names a record
  "sound": "Default",         optional: silent or a notify.json sound name; default
                              the kind's notify.json row
  "whereNames": {             optional: the context line in names, each part
    "woken": "mod core, done",       optional, cut at 60; drawn joined by a middle
    "project": "Tidewatch",          dot as "woken by mod core, done . Tidewatch
    "workstream": "the board",       . the board . track mod core . holds up the
    "track": "mod core",             tray cards", and preferred over where, which
    "holds": "the tray cards"        stays the fallback; woken is what woke a
  },                                 snoozed question, its name and ending
  "pick": "the output style"  optional: a question's recommended option by
                              name, drawn as "My pick: ...", cut at 80
}
```

ANSWERS: `200 {"ok":true,"via":"popup","files":n}` drawn by the popup;
`200 {"ok":true,"via":"held","reason":...}` held by notify.json
(`notifications are off`, `paused`, `quiet hours`, `this kind is switched
off`); `400 {"error":...}` a shape the popup cannot draw or a card off this
board; `503 {"error":...}` no tray attached, or an attached exe that does not
draw the popup. The route writes nothing, like `api/relay`. The kind's notify.json row is blocker `blocking`, question
`open`, answer `closed`, done `task-completed`, dropped `task-dropped`, closed
`plan-closed`; the other kinds have no row and are never switched off.

THE WIRE. An exe that draws the popup sends `x-askerdo-popup: 1` on its
stream attach, and only such a stream is sent the `alert` event:
`{kind, title, where, blocking, card, files, sound}` plus `place` (the names
joined), `pick` and `question` (the id of the question the card names, `Q12`)
only when set, where `card` is an absolute URL under the
board root (empty when the alert names none) and `files` is `[{id, index,
name}]` (never a path, exactly as `tray.recent`). When a question is answered, dropped
or snoozed, the same stream is sent `event: retract` with `{"question":"Q12"}`,
ahead of any alert that row raises, and the exe drops every card whose
`question` it names; a retract never starts the exe, and an exe built before it
ignores the event. A stream that did not
announce the popup is sent nothing: the server writes one log line and refuses
the alert with its reason. Every sender rides the same frame: the mod through
`api/alert`; the question watcher in-process; the server's own work endings through
`api/relay`, which takes `{"alert": ...}` (the request shape above, gates
already applied by the work notifier); and the notifications page's Test button and play
arrow. A request that fails validation or names a card off this board is drawn
as a plain card off its own title and `where`, with the `info` glyph and no
buttons, rather than dropped; only one with no title is refused.

THE EXE RE-CHECKS AND DRAWS. A card that does not start with its own
`--board` root, a file id that fails the store's shapes, or an index past 9999
is refused or dropped on arrival. Every alert that arrives is drawn in the
popup, whether the person is at the desk, presenting, full screen, away or in
quiet time: AskerDo's own settings (the master switch, the pause, the quiet
hours, each kind's show and sound) are the gates, applied before the frame is
sent, and Windows' notification switches are not consulted. A popup window that
will not open is one journal line. The sound is the row's cue played as the
`Notification.<name>` system sound alias, one per batch.

THE PREVIEW: `cargo run --example popup_preview -- <out.png> [dark|light]
[dpi] [hover] [all]` draws canned alerts into an offscreen bitmap and writes a
PNG. With `all` it draws every kind, three to a stack as the popup's cap allows,
into `<out>-1.png` through `<out>-4.png`. It includes `src/popup.rs` by path and
nothing else: no window, no identity, no network and no store.

## The activity console

The menu's `Activity` line opens one window, `AskerDo activity`, parked by the
tray's corner; a second click brings it forward. It is a live tail of the
board's activity log, grouped by day and newest first, two lines an entry (the
record and its name, then what happened, the project and the workstream by
name), a time at the right and a strip in the record kind's colour. One row per
change, as the web feed folds them: a record's lines for one verb
in one minute merge, a plain echo gives way to the line that says what it moved
to, repeats count ("task noted, 3 times"), and two different moves stay two.

THE FEED. Opening asks `<board>api/activity?limit=200` on a short-lived thread;
the page carries `wsNames` beside its lines so a workstream shows and filters by
name. After that the stream's own `change` frames carry every new line (the
poller writes one for each change it pulls in, so every machine's work shows),
merged on the network thread by log position and posted to the message loop.
A stream that reattaches asks for the page again when the window is open. No
poll, and nothing on the menu's path.

THE FILTER BOX is a standard EDIT control. Every word in it must appear in a
line's project, workstream (id or name), kind, verb, status, id or name, case
aside. A click on a line opens `<board>r/<key>` (the label when the line has no
key) in the browser, and the URL must sit under the exe's own `--board` root,
as every URL this exe opens.

Light or dark follows the taskbar theme as the popup does, with the popup's
palette; the box's frame and the question strip are the vivid sky blue family.
DPI aware per monitor. The pure halves (rows, filter, day labels, layout, hit
test, drawing) are `src/console_view.rs`; the window, the feed and the clicks
are `src/console.rs`.

THE PREVIEW: `cargo run --example console_preview -- <out.png> [dark|light]
[dpi] [filter]` draws a fixed sample of activity lines offscreen.

## The identity: the AUMID and the Start Menu shortcut

The process wears the AppUserModelID `ToxMox.AskerDo` from before its first
window (`tray::set_app_id`), so the taskbar takes the popup and the console for
one app, and the Start Menu shortcut below carries the same ID, so the shell
takes the shortcut and the windows for one app too.

`app.ico` IS THE APP'S ONE DRAWING: the package's mark ALONE, with NO rounded
tile behind it, enlarged to fill its whole canvas and in the dark set's colours
(the cream check and the hollow pink ring), which is exactly the drawing the
tray corner wears. Classic frames from 16 to 128
with a 256 px PNG frame beside them, and the 16, 24, 32 and 48 ones are
`tray-quiet.ico`'s OWN frames byte for byte, so the package's hinting at the
small sizes is copied rather than cut again; `test/icons.test.mjs` pins that
copy. The source is `assets/icons/app-mark-dark.svg`, which is `mark.svg` with
its two tile paths removed and the rest uniformly enlarged and centred the way
the package composes its tray faces; the 64, 128 and 256 frames were rendered
from it once, by hand, through the one-off tool named in
`assets/icons/README.md`, and this repo has no icon build step. `build.rs`
embeds it as the exe's own resource icon, so Explorer and the taskbar wear it,
and the Start Menu shortcut wears it. The `app-48.png` to `app-256.png`
rasters under `assets/icons/` are the icon package's exports and nothing reads
them.

THE OLD NOTIFICATION KEY GOES. Builds that raised Windows toasts wrote
`HKCU\Software\Classes\AppUserModelId\ToxMox.AskerDo` (`DisplayName`,
`IconUri`, `ShowInSettings`); the notification platform was its only reader
(the 2026-09-08 rows of `docs/desktop-capabilities.md`: the key bought toast
delivery and a row in Windows notification settings, while names and marks
resolved off the shortcut). Every resident start deletes it when it is there,
with one journal line, and so do `--register` and `--unregister`; a PC that
never had it costs one registry open. By hand:

```
reg delete HKCU\Software\Classes\AppUserModelId\ToxMox.AskerDo /f
```

THE SHORTCUT:

```
%APPDATA%\Microsoft\Windows\Start Menu\Programs\AskerDo.lnk
  target             the running exe
  arguments          --open (the click's own job, below)
  working directory  the exe's own directory
  icon               app.ico beside the exe
  System.AppUserModel.ID   ToxMox.AskerDo
```

THE FILE NAME IS THE NAME START SHOWS, which is why the link is named with the
display name and not with the exe's.

`shortcut.rs` writes it on a thread of its own and never in the start sequence:
it is not fatal (a missing shortcut costs Start its entry, while exiting for it
would cost the tray itself until the next demand), and the FIRST write of it
was measured once at 21 seconds on a cold shell, far past the window the server
gives the exe to attach. It is idempotent: the saved link is read back off disk
and a link already carrying this AUMID beside this exe's directory is left
alone, so every later start costs one file read. The read-back is on the BYTES
rather than through COM, because a shell link stores the AUMID and the working
directory as UTF-16 runs and does not store the target path verbatim at all.

THE UNDO IS ONE STEP:

```
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\AskerDo.lnk"
```

`askerdo-tray.exe --unregister` deletes the shortcut and the old key and exits
0. `askerdo-tray.exe --register` deletes the old key, writes the shortcut,
reads it back, prints `registered` and exits 0; it is STRICT where the resident
start is not, because a person running it is asking whether the shortcut is
whole, so a shortcut that did not land is exit 3 there. Neither flag is ever
used by the server; they are for hand use and for tests.

## What the shortcut's click does: `--open`

A Start Menu entry is a thing a person clicks, and a click that ran the exe
with no arguments would be exit 2 and a flash of nothing. So the link carries
ONE argument, `--open`, and that is a mode of its own:

```
askerdo-tray.exe --open [--log <path>]
```

It reads `board/port` and `board/secret` under the default store root
(`~/.claude/askerdo` under the folder Node's `homedir()` resolves to, the same
root and the same two files the JavaScript side reads), builds `http://127.0.0.1:<port>/<secret>/` (the
loopback form the `--board` argv carries, never the `.localhost` name, which the
browsers resolve themselves (Chromium and Firefox, measured 2026-09-15) and the
OS resolver does not know), asks the board's `ping` route
whether anything is answering there, and shell-opens the URL through the SAME
call the tray's "Open board" menu item and its double click use. No argv from a
server reaches this path and none is wanted: there is no server in the picture,
only a person and a store.

`--open` EXITS 0 EITHER WAY and it starts nothing. A store with no board
folder, an identity that fails the store's own rule (32 hex characters, a port
in range), or a port with nothing answering on it, all end in one journal line
and a quiet exit 0: DECIDING to start the board server is Node's job
(`lib/board-ensure.mjs`), never this mode's, and a person who clicked out of
habit gets silence rather than an error box or a tab onto a dead port. (the launcher) the start Node decides on runs through the scheduled task
whose action is this exe's `--serve`, the next section, so the exe does start
the board on ONE path; never on this one. `--log` is the same optional flag the
resident run takes, and without it there is no log and no line anywhere.

Because the argument is part of what the link must carry, the read-back
includes it: a link written before this cut has the AUMID and the working
directory but no `--open` run in its bytes, so it is rewritten exactly once and
then left alone like any other.

## The scheduled task's action: `--serve`

The board server is launched by a per-user scheduled task (the
launcher), never by the Claude session that noticed it was down (who
launches the board): a server started from inside a session inherits
Claude's Windows job, and that job kept an old package alive through a Claude
update. The task's action is this exe:

```
askerdo-tray.exe --serve --root <store root> [--log <path>]
```

WHY THE EXE AND NOT NODE. A task whose action is `node.exe` comes up with a real
console window (measured 2026-09-09: a Windows Terminal window visible for the
whole life of the process, and a legacy console host window just as visible),
and a node launcher script only shortens that to a flash of about a tenth of a
second. This exe is a GUI-subsystem image, so Windows gives it no console at
all: it is windowless BY CONSTRUCTION rather than by suppression.

WHAT IT DOES, ONCE. It resolves the server script from its own path (the exe
ships in `assets/`, so `hooks/board-server.mjs` is two parents and two joins
away), builds the command line `node.exe <script> --root <root>` with `node.exe`
looked up on PATH exactly as every hook resolves it, creates that process with
`CREATE_NO_WINDOW | DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP` (detached is
what leaves the server no console and no `conhost.exe` beside it, which is what
node's own `detached: true` set before this cut; `CREATE_NO_WINDOW` is
documented as ignored beside it and is kept because the ruling names it), closes
both handles and exits 0. Nothing is waited on: the task instance ends at once,
the task goes back to `Ready`, and the server it made outlives it.

`--root` is REQUIRED and has no default, because the store root is the one thing
a launcher must not assume: one that guessed would start a board over the wrong
store and answer pings from it. The server script is deliberately NOT an
argument, which is what makes the registered action self-describing: it names
one file, so a task left over from an older release is stale by the exe path
alone and `lib/board-ensure.mjs` re-registers it. The exe honours NO environment
seam, `ASKERDO_ROOT` included, so the node side's seam is not a second way in
here: `--root` stays the only one.

IT DOES NOTHING OF THE RESIDENT RUN: no key removal, no Start Menu shortcut, no
icon, no tray window, no events stream, and no store read. It starts one process
and leaves. `--log <path>` is the same optional flag every other mode takes, and
without it there is no log and no line anywhere. A failure is one journal line
and exit 2 (no `--root`, an exe sitting in no checkout, or a `CreateProcessW`
that failed), and the Node ensure that ran the task learns of it the way it
learns of every other failure to come up: its bounded ping wait times out and it
reports `failed` with the wait in the detail.

## Building it

The toolchain is PINNED in `rust-toolchain.toml`. rustup installs the named
toolchain beside your stable when you first build here, and the build script
refuses to run when the active toolchain is not the pinned one, because two
builds that do not produce the same bytes are two different binaries wearing
one name.

```
node scripts/build-tray.mjs                 # build, vendor the exe, write the notices
node scripts/build-tray.mjs --licenses-only # notices only, no compile
```

From the repo root. The script checks the toolchain, runs
`cargo build --release --locked` in `tray/`, copies the binary to
`assets/askerdo-tray.exe`, and derives
`assets/licenses/askerdo-tray.txt` from `cargo metadata`. It is
DEV-SIDE only: it never runs in CI and no test calls it, exactly as
`scripts/build-viewer.mjs` beside it never does. The built exe is committed,
so the runtime needs no install step of any kind.

The build passes two `--remap-path-prefix` rules, computed on the machine that
runs it, through `CARGO_ENCODED_RUSTFLAGS`: the cargo registry source root
becomes `cargo-registry` and this crate's directory becomes
`askerdo-tray`, so the panic locations rustc writes into the binary name
no builder's home. That variable REPLACES the rustflags in
`tray/.cargo/config.toml`, so `target-feature=+crt-static` is passed with them
and the C runtime stays inside the exe. Afterwards the script scans the exe as
BYTES, in UTF-8 and UTF-16LE, for the home path the run time reports, and fails
the build on a single hit; a plain `cargo build` in `tray/` does neither, so the
exe that ships is always the script's.

`cargo test` inside `tray/` runs the crate's own unit tests (the argv parser,
the URL splitter, the SSE frame reader, the icon parser, the taskbar theme
pick and the frame the tray wears). They touch no network and no registry.

## What is in the box

- `src/main.rs` argv, the exit codes, and the three threads: the message loop,
  the network, and the blocking stdin read that is the control channel.
- `src/tray.rs` the window, the notify icon, the six faces compiled in, the
  taskbar theme read at start and again on the shell's colour broadcast, the
  double click, and THE MENU: a pure model (`menu_model`) holding every word,
  every command id and every URL, and a thin walker that only appends it. The
  model carries the greyed counts line, the blocking questions and the waiting
  ones as two named blocks of up to five each, the Recent files block of up to
  five above them, `Open board`, `Activity` (the console), the two links each
  drawn only when its argv URL was passed, the pause parent and its submenu,
  and `Exit` (the section above says what each of them does). The line cut, the
  ampersand doubling, the pause tokens and the frozen URLs, the cards' vector
  and the recent files' own beside it, live here too.
  Never a balloon tip: a shown balloon would create a second app identity of
  its own.
- `src/icon.rs` the six committed `.ico` faces parsed, the taskbar theme that
  picks the set, and the frame found for the system small-icon metric: exact at
  16, 20, 24, 32 and 48, and area-averaged down from the 48 frame at 28, 36 and
  40 or scaled up above 48. Nothing is painted over it.
- `src/net.rs` the events stream, the liveness clock, the reconnect backoff,
  the ping fallback, the self-reap, the `open` event's dispatch as a value, the
  recent list checked on arrival, and the TWO writes this exe makes anywhere:
  the pause verb the menu POSTs to the board server's notify route, and the
  Recent files line's own POST to the open route.
- `src/opener.rs` the open frame's three shapes, the refusals, and the creation
  flags, which is the whole of what the exe does with an open (the section
  above says what it runs and what it will never parse).
- `src/popup.rs` the popup's stack, layout, hit test and GDI drawing, with no
  crate dependency so the preview example can include it; `src/alert.rs` the
  `alert` frame, the inbox every alert goes to, and the popup window.
- `src/console_view.rs` the activity console's rows, filter, layout and drawing,
  includable by the preview like popup.rs; `src/console.rs` its window, feed and
  clicks.
- `src/registry.rs` the old notification key's removal and the taskbar theme
  read, `src/http.rs` a hand-rolled HTTP/1.1
  client over `std::net::TcpStream` (loopback, no TLS, chunked bodies),
  `src/sse.rs` the frame reader, `src/url.rs` the URL splitter,
  `src/journal.rs` the optional `--log`.
- `src/open.rs` the `--open` mode, the Start Menu shortcut's click; `src/shortcut.rs`
  the shortcut itself, written and read back on a thread of its own; `src/serve.rs`
  the `--serve` mode, the scheduled task's action (the launcher), which
  creates the node server windowless and exits.

Dependencies, all of them: `windows-sys` (Win32 declarations), `windows`
(the shell link's COM types, for the Start Menu shortcut), `serde_json` (the
stream payloads), and
`winresource` at build time (the version resource and the exe icon). No async
runtime, no HTTP crate, no GUI framework.
