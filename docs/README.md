# AskerDo docs

This folder holds two kinds of document: the guide, written for people, and the reference that Claude sessions and AskerDo's own code read while running. Start with the guide. The reference is exact but written for the model.

## The guide (for people)

|Page|For|
|-|-|
|[Getting started](guide/getting-started.md)|Install on one PC, set up your replies, the first question, what a board adds|
|[Daily use](guide/daily-use.md)|The band, the status line, the pane's tabs, answering, and each `/askerdo` command|
|[Concepts](guide/concepts.md)|Questions, workstreams, tracks, handoffs, the depth meter, profiles, knowledge, decisions, procedures|
|[Set up a board](guide/board-setup.md)|Running the board server: Docker, ports, the data volume, tokens, backups, upgrades|
|[Add a PC](guide/add-a-pc.md)|Joining a PC with a code, what each platform gets, the tray|
|[Onboard a project](guide/onboarding.md)|Moving a project's old notes onto the board, and the undo|
|[Reply rules](guide/reply-rules.md)|Every rule of the reply contract, with an example of each|
|[Settings and rules](guide/settings-and-rules.md)|Reply settings, profiles and their layers, rule lines|
|[CLI reference](guide/cli.md)|Every `askerdo` verb|
|[Troubleshooting](guide/troubleshooting.md)|The board offline, paused notifications, a stuck track, the logs|
|[Architecture](guide/architecture.md)|The parts and how a question travels between them|

## The reference Claude reads

These files are part of the product: a session, a skill or the code reads them at run time, so their paths and headings stay put. Each is exact and written for the model; the guide is the readable version.

|File|What reads it|
|-|-|
|[askerdo-quick.md](askerdo-quick.md)|A session, at its first board call (the contract points here); the onboard skill's tour|
|[question-hub.md](question-hub.md)|A session in hub queue mode (the contract names it; `register --help` cites it); the onboard skill|
|[work-system.md](work-system.md)|A session working with workstreams, tasks, tracks, handoffs, knowledge and profiles (the contract names it)|
|[question-file.md](question-file.md)|A session in text queue mode, at its first question (the contract names it)|
|[handoff-timing.md](handoff-timing.md)|A session at the depth meter's handoff window (the mod's depth note points here)|
|[desktop-capabilities.md](desktop-capabilities.md), [tui-capabilities.md](tui-capabilities.md)|The contract's display rules rest on their measured, dated rows; the measure skill re-runs their test cards|
|[procedures/README.md](procedures/README.md)|The board's procedure parser: the shape every procedure card follows|
|[procedures/](procedures/) cards|A session, when the mod's watcher points at one or `/askerdo proc` finds it; the cards marked `everywhere` serve every project|
|[../skills/](../skills/) `*/SKILL.md`|Claude Code, when a skill runs (`/askerdo:configure`, `/askerdo:onboard`, `/askerdo:measure`, `/askerdo:chat-preferences`)|
|[../templates/handoff/](../templates/handoff/)|`askerdo ws create --handoff` copies it into a new workstream's handoff folder; a track's kickoff reads that folder's `rules.md` and `map.md`|

For contributors: [file-refs-spec.md](file-refs-spec.md) is the settled spec of file chips, the viewer and open-in, cited by the code that builds them.
