---
name: look-check
title: Read the drawn pane and band before asking the user to look
summary: "Before asking the user to look at the AskerDo pane, band or status row, read what they drew with the drawn tool, check each row the look rests on, and ask only for what needs the eye."
everywhere: true
triggers:
  words: [ask for a look, look at the pane, look at the band, check the pane, check the band, what the pane shows, what the band shows, sighting, sitting, drawn text]
---

# Read the drawn pane and band before asking the user to look

## Trigger

A step is about to ask the user to look at the AskerDo pane, the band above the prompt or the status row, to read a row, a fold, a count or a running time there. The session reads its own surfaces first, so the user's look is for judgment, not for reading rows back.

## Preconditions

- The session runs the AskerDo mod, so its `drawn` tool is listed (it loads through ToolSearch: `select:mcp__askerdo__drawn`).
- The surface the look rests on has drawn in this session: the pane is open on the tab the look needs, or the band or the status row shows.

## Steps

### 1. Name what the look rests on

Write down each row the look is about, as the user would see it: the part (pane, band or status row), the tab and fold, the row's words, and what should hold (a count, a running time, one row or two).

### 2. Read the drawn text

Call the `drawn` tool with `part` set to the part the look rests on (`pane`, `band` or `status`), or with no part for all three. It answers from the model each draw used: the rows and their words, which folds are open, the counts and running times, the columns the part was drawn for and how long before the read it drew. A part not drawn in this session says so; nothing is drawn for the call.

For a row that lives only while a foreground command runs (the Background fold's row of a long command), the session cannot call a tool while its own command runs: dispatch an agent first, told to wait and then call `drawn` with `part` `pane`, and run the command; the agent's call reads this session's surfaces.

### 3. Check each row against the drawn text

For each row from step 1: found as named, found but different, or not drawn. A row the text holds is settled by the session; say what was read and the time of the draw.

### 4. Ask only for what needs the eye

Ask the user to look only at what the text cannot hold: how a row wraps or is cut at a width, color and spacing, a hover card, whether a press feels right. Name the rows the session already read, with what it read, so the look does not read them back.

## Verify

```sh
askerdo show <question-id>
```

- expect: the look the session asked for (the question it registered, or the ask in its reply) names only what needs the eye, and says which rows the session read from the drawn text and when they drew.
- expect: no step of the look asks the user to read back a row, count or running time that the drawn text held.

## References

- `hooks/mod/index.ts::drawnTool`: the tool's handler, reading each part's last draw and the depth gate.
- `lib/mod-core.mjs::drawnText`: the text per part, from the models the draws used, bounded with what it left out.
- `docs/desktop-capabilities.md`: why a session cannot see or press the app's window itself.
