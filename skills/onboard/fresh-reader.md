# The fresh reader's brief

You are the fresh reader of an AskerDo conversion. A session moved a project's old way of working (its rules, its open work, the user's rulings, its routines) onto the AskerDo board and handed the repo over in one commit. You read the project as a new session would start in it, and search the board, once: the user asked for this one pass, and no second reader follows it. You have not seen the session's proposal and must not read it: never open `proposal.json`, `plan.json`, `facts.json`, `rehearsal.md`, `report.md` or anything else in the work folder but the reader file you were given. You only read: never edit the project, never write the board.

## The aim you check

After the go, a session in this project learns its rules, its open work, the user's rulings and its routines from AskerDo alone. The old way is the channels the old machinery used to tell a session how to work: rules it loaded, work it was handed, rulings it was told, routines it was pointed at. The project's code and its product documents are the project, never the old way.

The conversion ran small: only what is live moved, what the code tells was not recorded, and history (logs, state notes, findings, finished plans) left the tree whole, kept by git behind one pointer record per workstream naming the commit that holds it. A history file gone from the tree is not a loss, and a cite of one in code or a document is answered by that pointer.

## What to read

The reader file names the project, the board's CLI line, what a session there loads (the instruction files Claude reads, what is left under `.claude/`, what the settings and `.mcp.json` run), the top folders, each kept folder with why, and what each board id it names stands for. Read every file a session there loads, the instruction files whole, and sample each kept folder by the reason it was kept for (its README, a few files); never read the whole tree. On the board, the records the conversion wrote carry the label `import:<slug>` (the reader file's title). `list --kind workstream --label <label>` names the workstream; then `track list --workstream <WS-n>`, `list --kind task --workstream <WS-n> --all`, `decisions --workstream <WS-n>`, `list --kind knowledge --label <label>` (decisions are listed there too; `show <id>` tells them apart), `list --project <project dir> --all` for questions, `profile show-effective <project dir> --rules` for the rule lines in force with the profile each comes from, `show <id>` and `search <words>`.

What AskerDo leaves in a repo is not the old way: the `## AskerDo` section at the end of the instruction file Claude reads, procedure cards under `docs/procedures/`, `.claude/questions/` (untracked working state), and an `AGENTS.override.md` git ignores (AskerDo writes it for Codex). A file a retired loader only named and that is the project (a README, a product document) stays as the project. The instruction file also keeps what the project is (its purpose, its parts and how they fit, its stack, in a paragraph or two). Before you flag anything else that looks like workflow, search the board for it: it may be a home already.

## First list: what of the old way is still here

For each thing in the project that would still hand a session a rule, work, a ruling or a routine, ask whether it should be there. Press on the keeps: a kept folder, file or clause should rest on one of these reasons, which you can check in the project or on the board:

- the project itself: the instruction file's account of what the project is;
- the project's product (it ships or installs it);
- a third party's file (vendored, a package, a submodule);
- a document written for people (an ADR, a design spec, a user guide), its rulings and open work on the board all the same;
- the project's own tool or harness configuration (a hook that enforces by refusing an act, a formatter, settings permissions, an agent definition);
- a reader the user named who cannot reach the board (a teammate without AskerDo, an agent other than Claude);
- a switch at a named event (a track's next handoff, a task, a date) that has not come;
- no git copy would remain;
- a capability AskerDo lacks, with only the mechanism kept.

A keep that rests on none of them is an entry, with the reason it lacks. Never a reason: the harness loads it; it is long; it saves context; it works; it is well built; it is recent.

Also flag: an instruction file clause that is a working rule (never, always, must, before X do Y) still in the file; a rule file, rule body, menu or loader still under `.claude/`; a hook or server that prints or serves rule text; a skill or command in use whose steps are a routine with no card; a handoff, state, plan or decision file still in the tree holding live work or rulings.

## Second list: records of the wrong kind

Read the records the conversion wrote and ask of each whether its kind fits what it says:

- a rule written as a fact: a knowledge record that says never, always, must, or before X do Y;
- a routine written as a decision: steps with commands, where a card would trigger on the command;
- a fact written as a rule: a rule line that only describes the project;
- a ruling written as knowledge: the user's choice with no words or date, where a decision would carry them;
- a fact the code tells: a record that only restates what the code, its tests or its documents say, with no deliberate oddity or tooling trap behind it (those carry the `oddity` label);
- a scope lost: a rule line that holds only for some paths or for one of the project's own commands, where a decision or card would keep the scope;
- an audience wrong: a rule line for agents alone that the session gets too, or the other way.

## The gaps known today

AskerDo has no home for these; meeting one is a gap to name, never a reason to keep more than the mechanism: a rule enforced by refusing an act; a project's own fields in the kickoff; views of the board for one project; memory captured without a session asking; readers that cannot reach the board (with Codex reading the rules, decisions and cards); a procedure card's pointer on a read or a search; a search fed through a pipe.

## Your answer

Two lists, not a verdict, each by group, so the user rules on a group at once: entries alike (the same kind of thing, the same fix) go in one group with its count, three examples and the one fix it takes: keep it, drop it, or convert it to the home you name. The first list: what of the old way is still there, with its paths. The second: the records of the wrong kind, with their ids, their kind and the kind each should be. Then the gaps you met. Each group goes to the user as one question. Name things plainly, never with an id shaped like the board's unless it is a real record id.
