# File refs: chips, the viewer, and open-in (feature spec)

Status: SETTLED 2026-08-26, authored at the close of the live design
session that shaped it; the maintainer's go is recorded in the
decision log. Builds commission against this document under the
standing delegated-build pattern, ending at the session-model
reviewer gate (the first work system spec section 12). This spec EXTENDS the
work system: where the two documents touch, the first work system spec wins
on store semantics. Refs stay untyped pointers; nothing here adds a
field to any record.

Public-safety: no personal strings, no real machine paths (clearly
synthetic examples permitted), no secrets.

## 1. What it is

The `refs` list on work records becomes ACTIONABLE. Today a ref
renders as inert dot-separated text inside the card fold. After this
feature:

- a ref that is a work-record id links to that record's card, and a
  question id links to its question card;
- a ref that is an http or https URL links out;
- a ref that is a file path renders as a mono chip that opens an
  in-board VIEWER page, with the opener row under it (open, open
  with, editor, reveal, and the overflow; section 4).

Three granularities stay distinct, and this feature serves only the
third: a task's own spec lives in its write-once Intent; an arc's
shared document is a plan record; a document that genuinely lives in
a repo (a spec file, a handoff, a config) is a file ref.

## 2. Ref rendering (smart chips)

Shape is sniffed at render time; refs remain untyped strings and no
schema changes. Work and question ids resolve through the existing
permanent-URL scheme. Path detection is conservative (drive-letter,
slash-rooted, or relative-with-separator forms); anything ambiguous
stays inert text, exactly as today. The board's escaping discipline
is unchanged: every ref is escaped wherever it lands.

## 3. The viewer

One new board route, same posture as every other route (secret path
prefix, Host check, no-store, nosniff, no CORS, loopback only).

- The URL keys on RECORD plus REF INDEX, never a free path
  parameter: the record's own refs list IS the allowlist, resolved
  server-side at request time. A path that is not literally in the
  named record's refs is a 404.
- The server serves RAW BYTES only and never parses content: the
  house rule that there is no markdown parser on the server stands
  absolute. Text types only, size-capped; canonicalized paths;
  read-only always. A missing or moved file renders a clean "named
  here, not found now" page, never a 500.
- Rendering is CLIENT-SIDE on the viewer page, from vendored pinned
  assets beside uno.js (the existing vendoring precedent, licenses
  beside them): markdown-it for markdown, DOMPurify sanitizing every
  rendered fragment before it touches the DOM, highlight.js (common
  bundle) for code. The type ladder:
  - markdown: rendered formatted, then sanitized;
  - json: pretty-printed then highlighted, raw fallback when it does
    not parse;
  - yaml and recognized code extensions: highlighted;
  - txt, log, and unknown text: plain, house-styled;
  - binary or oversize: refused politely with the reason.
- Mermaid and KaTeX are OUT OF SCOPE for cut 1: fences render as
  highlighted code. Images are out of scope for cut 1 (text only).
- The page wears house.css and the board chrome register.
  Non-Chromium browsers are FIRST-CLASS: acceptance includes a
  Firefox pass, and viewer URLs follow the existing rule that
  non-Chromium contexts prefer the 127.0.0.1 form.

## 4. Open-in

REWRITTEN 2026-09-14 (the native file opener). ONE mechanism
now, not two: the tray exe is the only opener, reached over an `open`
frame on the events stream the toasts already ride. The browser mints
nothing, launches nothing, and never holds a program name or a path to
run.

- THE SEVEN KINDS. `OPEN_KINDS` in `lib/open-in.mjs` is the closed
  list a page may ask for: `open`, `openwith`, `reveal`, `editor`,
  `project`, `terminal`, `claude`. The five URL-scheme presets and the
  two server-launch targets this section used to name are gone with
  the mechanisms they belonged to.
- THE ASK IS A KIND, BY RECORD ID AND POSITION. A control POSTs
  `{"kind":"<one of the seven>"}` to `<secret>/f/<id>/<n>/open` and
  nothing else rides with it. The server resolves the position
  through the record's own refs list (a question's evidence list under
  section 9), stats the target ONCE at click time, and builds exactly
  one frame of three shapes:
  - `{ kind, verb: "open" | "openas", path }`, a shell verb on a path;
  - `{ kind, url }`, a URL through the shell;
  - `{ kind, exe, args: [ ... ] }`, a program with an argv array.
- WHICH PATH EACH KIND ACTS ON. `open`: the file itself, or the folder
  through the system folder handler, which honours a replaced Explorer
  and opens the folder with no selection. `openwith`: the
  `openas` verb on a file, and a refusal on a folder ("open with is
  for files"). `reveal`: the parent folder, by the same
  handler. `editor`: the editor setting's file template with the line
  and the column filled, or its folder template on a folder.
  `project`: the folder template on the folder. `terminal`:
  `wt.exe -d <folder>`. `claude`: `claude://code/new?folder=<folder>`,
  with no prefilled first message. `wt.exe` is the ONE program name the
  server ever puts on the wire, and no store ever named it.
- WHAT A FOLDER REF WILL NOT TAKE (2026-09-14). A folder
  ref's row draws `open`, `editor` and the overflow alone: `openwith`
  could only refuse, a folder's own `open` already shows it so `reveal`
  is that gesture twice, and folder in editor is what its `editor`
  already does, so that entry leaves a folder's overflow too. A folder's
  overflow is copy path in both forms, a terminal here and open in
  Claude Code. The route is the belt behind the omission: `reveal` and
  `project` on a folder ref are a 409 saying so.
- WHAT THE ANSWERS MEAN. 200 means the frame was WRITTEN to the tray
  and nothing more. A kind the target cannot take, a template that
  will not expand, and a path that is not there now are each a 409
  carrying the server's own sentence, which the row prints. No tray to
  write to is a 503: the server starts the exe on demand first and
  waits for the attach, and neither the notification master switch nor
  an earlier Exit refuses an open, because a click is a demand from the
  person. The exe reads the frame, runs exactly one shape, and writes
  one journal line per open.
- CHOICE UI: THE ROW, in the DETAIL PANE beside each linked path
   and under each drive-letter evidence entry on a question
  card, built by one builder so the two surfaces cannot drift. Four
  controls, `open`, `open with`, `editor`, a separator, `reveal`, and
  an OVERFLOW holding copy path in both forms, a terminal
  here, folder in editor and open in Claude Code. That entry is named
  for what it does (2026-09-14): it opens the ref's folder
  in the editor the setting names, and "the project folder" said
  neither. The VIEWER PAGE keeps the same row and stays for READING,
  dropping open with and reveal the moment its own 409 says the ref is a
  folder. Copy path reads the path off the chip already on screen and
  reaches no route at all. The per-browser remembered pick went with the
  picker it belonged to: the row is four controls and a menu, not a
  chooser.
- THE ROW STANDS ONLY UNDER A REF THAT RESOLVES (
  2026-09-14). The server stats every path ref of the record a fragment
  renders, through the one resolution, and hands the page
  `openable: { [id]: { [index]: { isDir } } }`. A chip whose file is not
  there keeps its link to the viewer, where the reader is told what is
  wrong, and gets NO row, so nothing red is ever drawn on a card; and a
  page knows a ref is a folder because the server said so, never by
  guessing from the spelling. One stat per path ref per fragment render,
  and the render is cached per record and invalidated on every change
  and every open.
- AN ANNOTATED ENTRY RESOLVES BY ITS PATH (2026-09-14).
  The older evidence lists spell `path (a note)`. Where the whole
  string is not on disk as written and it closes on `)` carrying ` (`,
  the resolution retries the part before the LAST ` (` once, BEFORE the
  `:line` cut, so `path:42:7 (a note)` keeps its two numbers. The retry
  is in the one resolution, so the viewer, the raw route, the open route
  and the allowlist all take it; a file whose own name closes on a
  bracket is stat-ed first and stays itself.
- THE TOUCH STAMP. A dispatched open writes
  `board/recent.json`, a server-owned list and never a field on a
  record, so the CLI stays the only writer of records: 20 stored, 5 on
  the tray menu's Recent files section, 3 on the record's own detail.
  IT RECORDS FILES ALONE (2026-09-14): `open`, `openwith`,
  `editor` or `reveal` on a FILE ref writes the stamp for that file, and
  a folder ref on any kind, plus the three folder gestures on any ref,
  write nothing, so both lists carry files by construction.
  EVERY READER RE-RESOLVES an entry through the refs list before it
  renders and drops what the record no longer names at that position,
  which keeps the refs list the only path authority even for a list of
  paths. Nothing is written on a refusal, on a viewer page read, or on
  a copy.

## 5. Settings

REWRITTEN 2026-09-14. ONE key rides the existing store
settings file (the notify keys' home, `board/notify.json`), with two
templates and no more:

```
editor: { file: 'vscode://file/{path}:{line}:{col}',
          folder: 'vscode://file/{path}/' }
```

- Either template is a SCHEME URL or a COMMAND LINE, and the `://` is
  what tells them apart, since a drive letter carries one slash and not
  two. `{path}`, `{line}` and `{col}` are filled in, and a `:{line}` or
  `:{col}` tail leaves WITH its value when the ref names neither. A
  command line is tokenized once respecting double quotes and the path
  is filled into whole tokens, so a path carrying spaces can never
  split into two arguments; the first token is the program and has to
  be your own text, so a template naming `{path}` there is refused in
  words rather than run. Either template may be at most 2048
  characters, and a longer one falls back to the default.
- IT IS EDITED ON A PAGE, in the Openers section at the foot of the
  notifications page, each field one POST of one value. THE SERVER
  NEVER RUNS IT: the board tokenizes the template and hands the tray
  exe a program and an argument list, and the exe is what runs them.
  That is what lets a template ride to a page at all, where
  `openCommand` never could.
- THE COMMAND EXAMPLE IS THE FULL PATH to the program, as in
  `"C:/Program Files/Microsoft VS Code/Code.exe" {path}`, and the
  page's help line says why. Measured on this machine: the full path
  starts VS Code (2026-09-13); `code {path}` is not found at all and
  the open fails silently; `code.cmd {path}` reported success and hung
  while the child inherited the exe's standard handles (2026-09-13),
  and starts the editor now that all three are null (2026-09-14); the full path works either way. The DEFAULT is the
  vscode scheme, which works and carried `:42:7` into a running window.
- An absent or empty `folder` template omits the project-folder entry
  from the overflow altogether and refuses the `project` kind with a
  sentence, rather than leaving a control that can only answer one.
- `openPreset`, `openScheme` and `openCommand` ARE RETIRED, and a
  hand-written `openCommand` IS NOT MIGRATED into `editor`. The old key
  named a program the SERVER ran and the new one names a program the
  EXE runs, and a silent promotion between those two is the one thing
  this cut exists to stop. The three names are deleted from the file on
  its next write and are refused on the notifications route the way any
  unknown key is, so a stale page learns what happened rather than being
  quietly ignored.

## 6. Security redlines (design around, never relax)

- The refs list is the ONLY path authority (widened by section 9 to
  the named lists: refs, and a question's evidence); no route ever
  takes a free path. Canonicalize before use; refuse traversal.
- The server never parses viewed content; the client sanitizes
  through DOMPurify before DOM insertion.
- THE PAGE NAMES A KIND, never a command and never a path. The seven
  names of `OPEN_KINDS` are the whole vocabulary a control may post,
  every one of them a literal in the page module; the address is a
  record id and a list position. Command text comes only from the
  user's own settings file, and THE SERVER NEVER RUNS IT: it tokenizes
  the template and the tray exe runs the program. (Re-aimed 2026-09-14
; the redline itself did not move.)
- THE EXE RUNS ONLY WHAT ARRIVES ON THE OPEN FRAME, and the frame is
  built by the server out of a record's own list. The exe parses no
  template, resolves no path and names no program of its own; a frame
  that is not exactly one of the three shapes is one journal line and
  no call at all. The tray menu's Recent files click asks the board
  over the very same route, so the exe never holds a path it was not
  handed on a frame. (new 2026-09-14.)
- A path is always an argv element or a frame field, never shell text.
  The command shape carries an argv ARRAY end to end, and the exe's
  process builder does the Windows quoting from it; nothing on either
  side of the wire concatenates a path into a command line. The
  server's own open spawn is gone with the two mechanisms section 4
  used to describe.
- Text only, size-capped, read-only; the secret, Host check, and
  loopback posture are unchanged.
- Vendored assets are pinned, committed with licenses, and refreshed
  deliberately (DOMPurify first among them).

## 7. Out of scope

Mermaid and KaTeX rendering; images; a board-side refs composer (the
CLI's --add-ref and --remove-ref stay the write path); serving
anything to a non-loopback client; any archive or snapshot of
referenced files (the export verb owns snapshots, and originals stay
byte-untouched).

## 8. Build order

1. THE BOARD TAKEOVER HOLE FIRST: bake the version at server
   boot and report the baked value on ping, so this very arc's
   dogfood bump reaches the live board without a manual stop.
2. Smart chips, the viewer route, the vendored client stack, and the
   viewer page.
3. Open-in: the scheme presets, the reveal route, the custom app
   command, and the picker.

Each cut runs the standing pattern (pinned contract, Opus
implementer, multi-lens Opus verify, integrator rulings, the
session-model reviewer gate, the integrator reading critical diffs
personally), suite green before every push, and the arc ends with a
dogfood bump.

## 9. Addition, 2026-08-27: question ids on the same routes

QUESTION ids join the resolution the f/ routes already run (
the viz expansion), so the cite chips, backs lines, excerpts, and
peeks a served visualization page carries resolve rather than
pointing at a route that does not exist. This is ONE id shape added
to the ONE resolver, not a second resolution.

- The URL is `f/<Qid>/<n>`, with the same three shapes a work
  record's id takes: the viewer page, the `/raw` bytes, and the POST
  `/open`. The grammar is unchanged, a record id plus a list
  position, and there is still no path parameter anywhere.
- A QUESTION'S EVIDENCE LIST IS THE ALLOWLIST, exactly as a record's
  refs list is. Position n is the nth entry of the evidence fold that
  question's card renders, COUNTING FROM 0 (the first entry is `/0`;
  the viewer page labels the same position one-based as "ref 1 of
  N"); an entry the chip classifier does not call
  a path holds its position and resolves to nothing; the
  canonicalized target is checked back against that question's own
  evidence before a byte is read. Nothing else in the list is
  reachable, and no other question's list is.
- Evidence entries are free strings out of a register payload, so
  they are trusted no further than a ref is: the same shape reading
  decides which are openable (drive-letter on win32, the platform's
  own reading elsewhere), and everything else stays inert.
- Everything else is the work path's, unchanged: the size cap, the
  NUL sniff, the read-only text-only rule, the secret prefix, the
  Host check, no-store, nosniff, no CORS, and the open route's kind
  discipline. The only thing that reads off the id shape is the way
  back, which is the question's own card.
- A miss is one answer in every direction: no such question, a
  position past the end, a position holding a string that is no path,
  and an empty evidence list all 404 alike, so the route never says
  which ids exist.
