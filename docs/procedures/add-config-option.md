---
name: add-config-option
title: Add a config option to the AskerDo contract
summary: Thread one new toggle or dropdown through the places it touches, from the builder rule and the settings table to the configure interview, then regenerate the fixtures and the rules page.
triggers:
  words: [add a config option, new option, new toggle, new dropdown, configurator option]
  commands: []
  files:
    - glob: lib/node-helpers.mjs
      contains: DEFAULT_CONFIG
    - glob: server/verbs/profile-rules.mjs
      contains: contractFamily
repos: {}
---

# Add a config option to the AskerDo contract

## Trigger

A new rule or behavior in the generated output style should be switchable by the user: a checkbox (boolean) or a dropdown (one of a few values).

## Preconditions

- The option's name, kind (toggle or dropdown), values and default are settled.
- The work happens on a branch in a worktree, or the builder edit is finished within the session: the SessionStart sync regenerates the user's live output style from this working tree, so a half-finished `lib/builder.js` leaks into real sessions.
- The suite is green before starting. check: `node scripts/run-tests.mjs` exits 0.

## Steps

### 1. Builder: the rule text and the palette conditionals

Edit `lib/builder.js`: add the rule text gated on the option, and the palette conditionals it needs. No em or en dashes in any generated text (tests enforce it).

### 2. Defaults

Edit `lib/node-helpers.mjs`: add the option with its default to `DEFAULT_CONFIG`. `loadConfig` merges saved configs over the defaults, so configs saved before the option existed stay valid.

### 3. The settings table

Edit `server/verbs/profile-rules.mjs`, where every setting's kind, values and default live with the copy every renderer shows: `label` (its name), `line` (one plain line of what it does), `changes` (what it changes), `example` (an `a`/`b` pair, the `values` of a choice with `choices` naming each, or one `text`, filled from the row) and `takes` (its family in `TAKES_EFFECT`, when a save takes effect). A contract option gets a row in `contractFamily()`, and an option that belongs to one PC (never a board profile) goes in `PC_SETTINGS`. That one row is enough for `askerdo settings` to list it, for the pane's Settings tab and the board page to draw and explain it, for `checkSetting` to validate it, for `askerdo settings set` to write it, and for a board user's save to carry it on their profile. The contract save (`lib/contract-save.mjs`) keeps no lists of its own: its `validate()` checks the shape and takes each value through `checkSetting`, and its saved keys come from `CONTRACT_KEYS`.

### 4. The rules page, when the option adds a rule

The rules page (`docs/guide/reply-rules.md`) explains the rules and edits nothing; the option itself lives in the pane's Settings tab, drawn from step 3. When the option adds a rule, edit `scripts/build-rules-ref.mjs`: a card in `CARDS` for the new rule, its family, the `match` that finds it in the builder's output, its explanation and its example. The page computes the rule numbers, the count and what each setting switches from the builder, and the build fails while a rule has no card.

### 5. Configure skill

Edit `skills/configure/SKILL.md`: add the option to the interview list.

### 6. Tests

Edit `test/builder.test.mjs`: add the key to each base config, add a case for the non-default value, and targeted asserts for the rule text.

### 7. Regenerate the golden fixtures

The fixtures pin exact bytes, and fixture prose is never hand-edited. Write a throwaway script OUTSIDE the repo (the session scratchpad), paste `base`, `cases`, `customRules` and `styleCases` into it verbatim from `test/builder.test.mjs`, and run it from the repo root.

```js
// <scratch>/regen-fixtures.mjs: throwaway, never committed
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.cwd();
const { buildOutputStyle, buildChatPreferences, buildPaletteMarkdown } =
  await import(pathToFileURL(join(root, 'lib', 'builder.js')).href);
const fx = (n) => join(root, 'test', 'fixtures', n);
// paste base, cases, customRules and styleCases here, verbatim from test/builder.test.mjs
for (const [k, c] of Object.entries(styleCases)) writeFileSync(fx(k + '.output-style.md'), buildOutputStyle(c));
for (const [k, c] of Object.entries(cases)) writeFileSync(fx(k + '.chat-prefs.txt'), buildChatPreferences(c));
writeFileSync(fx('palette.md'), buildPaletteMarkdown());
```

```sh
node <scratch>/regen-fixtures.mjs
git diff --stat -- test/fixtures
```

Read the fixture diff: it should show the new rule text and nothing else.

### 8. README and CHANGELOG

Edit `README.md`: the options wording and the "What it writes, and where" table. Edit `CHANGELOG.md`: one bullet under `## Unreleased`, a short paragraph (the lead clause, the ruling it answers, what changed, the measured numbers).

### 9. Run the build

```sh
node scripts/build.mjs
```

## Verify

```sh
node scripts/run-tests.mjs
node scripts/build.mjs --check
git status --short
```

- expect: `node scripts/run-tests.mjs` exits 0, with the new cases among the passing tests.
- expect: `node scripts/build.mjs --check` exits 0 (`docs/guide/reply-rules.md` and `docs/guide/cli.md` are current).
- expect: `git status --short` lists only the files named in steps 1 to 9, the regenerated fixtures and `docs/guide/reply-rules.md`; no regen script inside the repo.

## References

- `lib/builder.js`: the one source of the contract text (step 1).
- `lib/node-helpers.mjs::DEFAULT_CONFIG`: the defaults saved configs merge over.
- `server/verbs/profile-rules.mjs::contractFamily(`: the contract options' rows.
- `server/verbs/profile-rules.mjs::checkSetting(`: the one validation every surface runs.
- `lib/contract-save.mjs::validate(`: the save's strict shape check over `checkSetting`.
- `scripts/build-rules-ref.mjs::CARDS`: the rule cards.
- `skills/configure/SKILL.md`: the interview list.
- `test/builder.test.mjs`: the case configs the fixture regen copies verbatim.
- `test/fixtures/`: the golden fixtures, regenerated never hand-edited.
- `README.md`: options wording and the what-it-writes table.
- `CHANGELOG.md`: the Unreleased bullet.
- `scripts/build.mjs`: writes and checks `docs/guide/reply-rules.md`.
- `docs/guide/reply-rules.md`: the generated rules page.
