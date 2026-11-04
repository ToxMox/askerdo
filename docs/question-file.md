# The question queue: files, lifecycle, and rendering

Read this once per session, at the moment a question first registers (a
question that outlived the message that asked it, per the contract's queue
rule). This file is the operational spec for queue mode `text`; the
contract carries only the behavioral rule, and queue mode `hub` follows
`question-hub.md` beside this file instead.

## Where the queue lives

`.claude/questions/<session-id>/` in the project (the working directory),
where `<session-id>` is read from the scratchpad path the harness
announces (the `...\<session-id>\scratchpad` tail). Session-scoped on
purpose: each session owns its directory and parallel sessions never
share one.

Project-local was chosen deliberately (2026-08-14) over both the Temp
scratchpad and the plugin data dir: links become short repo-relative
paths that work on any drive layout, a live queue survives temp
cleaners, a resumed session finds its queue weeks later, and the queue
follows its project's lifecycle, so deleting or archiving the project
takes the crumbs with it. There is NO automatic sweep beyond that:
finished sessions leave kilobytes of markdown, deletable by hand.

Git treats these as what they are, untracked working state: NEVER stage
or commit anything under `.claude/questions/`, including in "commit
everything" requests. Ignoring is left to each repo's own rules; the
line to add is `.claude/questions/` (in `.gitignore`, or locally in
`.git/info/exclude` to keep it out of the tracked tree). In folders
that are not git repos, none of this arises.

If no scratchpad path is announced (so no session id), skip files
entirely and keep only a count line in footers.

The layout inside is flat, and files NEVER move:

```text
.claude/questions/<session-id>/
  index.md              regenerated jump table of the open set
  Q4-store-shape.md     one file per question; status in the frontmatter
  Q7-bar-cadence.md
```

Never moving is load-bearing: every names-line link ever rendered keeps
resolving for the rest of the session, and clicking an old link to an
answered question shows its recorded Answer, so stale links act as
resolution lookups instead of dead ends. (Measured 2026-08-14: the pane
shows a "couldn't read this file" card for a moved or deleted target,
which is exactly why status is a frontmatter flip, never a move.)

## One file per question

Filename: `Q<n>-<kebab-slug>.md`, where the slug is the question's short
name. IDs are assigned at first telling in reply text, count upward within
the session, and are never reused or renumbered; a file inherits the ID its
question already had. After a compaction, take the highest ID across the
files and conversation memory and skip forward when unsure: gaps are
harmless, collisions are not.

Template:

```markdown
---
id: Q4
name: store shape
ask: One file for the whole queue (4a), or a file per question (4b, my pick)?
topic: open-questions-store
status: open
blocking: false
created: 2026-08-14
asked: 1
pick: 4b
---

[all open questions](index.md)

# Q4 store shape

Came up while designing the question store. Decides edit safety and
what a session must read at start.

Crux: whether two sessions ever edit the queue at once.

| type | option | what happens | catch |
|-|-|-|-|
| 4a | single file | simplest possible store | every edit touches everything |
| 4b * | file per question | isolated edits, filesystem as index | more files to manage |

## Answer
(filled at close: what was chosen, and why)
```

Field notes: `name` is the short human hook shown beside the ID everywhere
(IDs never appear bare); `ask` is the question line: one plain question
ending in a question mark that names the options inline with their
tokens and the pick; the line under the title is why the question came
up, never the ask again; `status` is `open`, `answered`, or `dropped`,
flipped in place at close; `blocking: true` means work is waiting on the
answer; `asked` counts tellings and is bumped each time the question is
surfaced again; each option's `type` cell is its ANSWER TOKEN, the
question's number and the option's letter (`4a`, `4b`), one token that
names its question wherever it is read or typed; `pick` is the
recommended token when there is one, marked "(my pick)" beside its
option wherever the options render.

Rulings (T-6): an answered question is a ruling.

- `revisits: [Q512]`: the answered questions this one reopens. Each must be
  answered, else the registration is refused.
- `reversal`: required with `revisits`, refused without it: what changed
  since the ruling, in short lines. The hub writes `## Reverses` itself,
  frozen at registration: the ruling's label and name, its Answer's first
  paragraph verbatim, and each option it did not choose with its catch.
  The reversal's text goes in `## Reversal`.
- A question with `revisits` is stored blocking and told alone, in a reply
  of its own, its ask leading with Reversal of Q-n, and its decision table
  too: every reply writes the full copy in its footer, and on the desktop
  the mod hides it under the card and draws the footer under the last card,
  with one line in it that names the question and says it is on the card
  above. When
  the same session registered another question within the minute (before
  or after it), the hub still registers it, returns `beside` with the other
  labels and a note; the mod marks both cards and the turn-end note says so.
- `cites: [Q498]`: answered questions mentioned as context only. On the
  model's path a Q-n label of an answered question in the ask, crux, gist,
  stakes or option text that is in neither list is refused.

## The index

`questions/index.md` is regenerated on every set change (a registration,
an answer, a drop): one table of the OPEN set, blockers first then oldest,
each row carrying the ID and name as a link to the question's file
(relative, same directory), a blocks chip, and the one-line gist. Links
inside a pane-rendered markdown file navigate the pane (measured
2026-08-14), so the index is a jump table, not just an overview. Each
question file's first body line links back (`[all open questions](index.md)`),
making pane navigation two-way.

## Lifecycle

1. **Asked**: inline, in full, exactly once. No file yet, so a lone final
   question answered straight away never touches disk.
2. **Registered**: composing any later message while the question is still
   unanswered writes its file (`status: open`) and regenerates the index.
3. **Surfaced**: the question is shown again in reply text as a decision
   table, because `q` was typed or a repeat telling was warranted; bump
   `asked` each time.
4. **Closed**: fill `## Answer` with the choice and its why (for a drop,
   record that it was dropped), flip `status`, regenerate the index.
   Files are never moved or deleted mid-session.
5. **Graduated**: when the answer settled a durable project decision, also
   record it durably at close time: a decision note under the repo's
   `docs/`, never Claude's auto memory. Wording-level answers just keep
   their Answer section.

## The names line

While open questions exist, every substantive reply ends with the names
line. An empty queue renders nothing, and tier-1 one-liners stay bare as
ever.

The names line is reply text, because only reply-text links open the
file pane (no link form inside a widget can, measured 2026-08-14, while
reply-text links resolve `../` traversal out of the working directory).
Format, with the count link bold:

```markdown
❓ **[5 open questions](<path>/questions/index.md)**: [Q4 store shape](<path>/questions/Q4-store-shape.md) · [Q7 bar cadence](…) · [Q9 tag glyph](…) and [2 more](<path>/questions/index.md)
```

The bolded count always links the index; the top three names (blockers
first, then oldest) each link their own file; "and [N more]" links the
index again and appears only past three. Paths are repo-relative
(`.claude/questions/<session-id>/Q4-store-shape.md`), never absolute.

## Answering

Answers are typed: the option tokens from the first telling, each the
question's number and the option's letter (`4b`), free words, or
`drop Q4` to decline. Typing `q` prints the open set as decision
tables, one block per question: the question line first (the ask, one
plain question ending in a question mark that names the options inline
with their tokens and the pick), then a one-line crux (the fact that
decides it), then its options as a
`| type | option | what happens | catch |` table, the same shape as the
template above: the catch empty when there is none and "one-way" when
the choice is hard to undo, and the recommended token starred (`4b *`)
when there is one. The blocks carry the answerable
core only; context is the file, one sidebar click away via the names
line.

## Modes

- `queue: text` is this file: the session-scoped file queue above, with
  typed answers.
- `queue: hub` replaces the session queue with the AskerDo board
  (AskerDo's own server, shared by every machine) and the labels it
  issues; its operational spec is `question-hub.md`, and this file does
  not apply there. In hub mode a session that has not engaged the board
  keeps its questions with itself under local labels (`L1`, answered
  `L1a`) until the user's own act or a kickoff engages it, then files
  them (`question-hub.md`, Registration happens at ask time).
- `queue: off` uses no files: the classic footer restates the complete
  outstanding set every reply.

## What replaced what

With the queue on, the classic footer machinery is retired: no restating
the complete outstanding set, no waiting tallies, no compression tables
past three items. The names line and the files are the complete set and
the memory. Blocking questions still block their work until answered, and
a default is only ever a proposal, never auto-applied. When a preference
gates output produced in the same turn, the output renders provisionally
and says which way it went while the question stays open, and a later
answer redoes it: a provisional render is not a default applied by
silence, which stays forbidden.
