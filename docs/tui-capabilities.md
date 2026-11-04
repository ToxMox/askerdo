# Terminal display capabilities: the fallback surface

Subject: the **Claude Code CLI markdown renderer** (a bundled `marked` parser plus a custom
terminal renderer), not any particular terminal emulator. Almost everything that bites is a
renderer limit, so these findings hold in Windows Terminal, WezTerm, iTerm2, Alacritty, the
VS Code integrated terminal, and anything else that draws a competent ANSI surface. The
handful of behaviors that genuinely vary by emulator are quarantined in section 2b, so the
matrix in section 2 can be read as universal.

First measured 2026-07-25 in the VS Code integrated terminal on Windows 11 (a monospace Nerd Font).
Re-run the test card in section 6 to confirm on any other setup.

## When this file applies

The active presentation contract (the output style installed at
`~/.claude/output-styles/askerdo.md`, selected by `"outputStyle"` in
`~/.claude/settings.json`) is measured against the Claude Code
**desktop app**, and its evidence lives in `docs/desktop-capabilities.md`. This file is the
fallback. Read it when running in a terminal CLI session, the editor extension, over SSH,
headless, or under cron, and let the measured limits below win wherever they conflict with the
contract. When the surface is genuinely ambiguous, prefer these rules anyway, since they are
the stricter subset and degrade safely on either surface.

## Rule deltas when running in a terminal

The contract holds except for the clauses below, which this renderer cannot support. Rules are
keyed by their opening words rather than by number, because the numbering shifts whenever a
rule is added or removed. Grep the quoted phrase in the installed output style to find the rule.

| rule opens with | contract says (desktop) | terminal override |
|-|-|-|
| "Multi-part work carries counts" | arcs of 3+ steps become a bullet list led by ✅, ⏳ or ❌ | Works here too: single-codepoint emoji render at two cells. Only the markdown checkbox list is unavailable, printing a literal `[x]`. The `▰▰▰▱▱` meter and `├─` / `└─` trees render gapless here, so they are *stronger* on this surface than on the desktop |
| "Length is guidance" | link a local `docs/` path so one click opens it in a pane | There is no pane. Give the path plainly; most emulators linkify it themselves |
| "One topic per bullet" | nest bullets one level, two when the content is really a tree | One level only, and children must fit on one line, because a wrapped continuation line snaps back to column 0 and destroys the nesting |
| "sits alone in a fenced block" | shell commands tagged `bash` earn a Run button | No Run button exists. The fenced block is still the right shape, it just is not clickable |
| "Use the markdown the app actually renders" | two heading tiers, `#` loud and `##` quiet | One tier. `#` is bold plus italic plus underline; `##` through `######` are indistinguishable from bold body text |
| "Use the markdown the app actually renders" | strikethrough nests inside bold | It does not. `**~~x~~**` prints the tildes literally and recolors the span. Never nest |
| "Use the markdown the app actually renders" | link file paths rather than pasting them | A link renders as `label (full url)`, so it never shortens anything. Use one only where the label carries meaning the path does not |
| "Use the markdown the app actually renders" | footnotes render properly | No footnote extension is loaded. Marker and definition both print literally |
| "Use the markdown the app actually renders" | quotes nest | Every blockquote depth collapses to the same single bar |
| "Use the markdown the app actually renders" | a readout borrows the diff fence only when a red line must catch the eye, because a pass/fail checklist is a glyph-led list instead | The redirect still works, since a glyph-led list renders here too (row 3). The difference is that the diff fence is more valuable on this surface, being the only way to get green and red into a reply at all, so treat the narrowing as a preference rather than a ban |
| "The fold." | the fold is a true full-width rule | `---` emits the literal three-character string, unstyled and never width-aware. The fold still marks the boundary, it is just quiet |

Every other rule is surface-independent and applies unchanged: "Bottom line first", the footer rule ("Needs you:" / "Nothing needed yet:" / "Next up:" / "Done." always last), the em/en-dash ban, "No time estimates", "Decision tables", and "Reply tiers".

## 1. Summary

This terminal is a rich ANSI surface behind a deliberately narrow markdown renderer, so the
limits that bite are almost always renderer limits, not terminal limits. What reliably works
is the small classic set: weight (bold), italic, blue inline code, a dim left bar for
blockquotes, box-bordered tables, `-` bulleted lists, numbered lists, syntax-highlighted
fenced code including red/green diff fences, single-codepoint emoji at two cells, and OSC 8
hyperlinks. What is structurally unavailable is anything the renderer flattens or drops:
heading tiers below h1 collapse to one look, blockquote nesting collapses to one bar, the
`---` rule is a literal three-character string, wrapped list lines lose their indent, HTML and
footnotes and link reference definitions pass through as literal text, and bold can never
carry a color because the default foreground is exempt from the bright-palette shift. The
interesting frontier is the layer underneath: most modern emulators support dim, five underline
styles, independently colored underlines, overline, strikethrough, truecolor, gapless
box-drawing and block glyphs, and inline images, and it is untested whether the CLI renderer
lets any raw escape sequence through to reach them at all. Treat the MEASURED rows as ground truth,
the DOCUMENTED rows as strong priors, and settle the UNVERIFIED rows with the test card in
section 6 before the reply contract leans on any of them.

Confidence key: MEASURED means proven from a screenshot of this exact terminal. DOCUMENTED
means read from a cited source (the shipped CLI bundle, emulator source or docs, a tracked
issue). INFERRED means reasoned from those sources without a direct
observation.

## 2. Capability matrix

| device | renders? | how it looks | confidence | source |
|-|-|-|-|-|
| bold `**x**` | GOOD | heavier weight only; foreground color is identical to plain text | MEASURED | screenshot |
| bold used as a color signal | NONE | the bright-palette shift only applies to palette indices 0 to 7, never to the default foreground, in any renderer or setting | MEASURED | screenshot, xterm.js TextureAtlas.ts and DomRendererRowFactory.ts |
| italic `*x*` | GOOD | true slanted italic | MEASURED | screenshot |
| inline code `` `x` `` | GOOD | blue foreground (theme "permission" color) | MEASURED | screenshot |
| blockquote `>` | GOOD | dim left bar (U+258E) plus space on every non-empty line; body text is also italicised | MEASURED (bar), DOCUMENTED (italic) | screenshot, CLI bundle |
| markdown table | GOOD | full drawn box borders, per-column widths | MEASURED | screenshot |
| unordered list | GOOD | literal `-` marker, never a bullet glyph, at every depth | MEASURED | screenshot, CLI bundle |
| wrapped list continuation line | WEAK | returns to column 0 with no hanging indent, so long items lose their structure | MEASURED | screenshot, CLI bundle |
| `---` horizontal rule | WEAK | the literal three-character string, unstyled, never width-aware | MEASURED | screenshot, CLI bundle |
| h1 `#` | GOOD | bold plus italic plus underline; the only heading tier with a look of its own | MEASURED | screenshot 2026-07-25 |
| h2 through h6 | WEAK | bold only, visually identical to inline bold body text, so there is no tier below h1 | MEASURED | screenshot 2026-07-25 |
| ordered list | GOOD | number plus dot at depth 0 and 1 | DOCUMENTED | CLI bundle |
| ordered list depth markers | GOOD | the cycle runs one level earlier than the bundle read suggested: depth 0 `1.`, depth 1 `a.`, depth 2 `i.`, depth 3 back to `1.` | MEASURED | screenshot 2026-07-25 |
| nested list indent | GOOD | indents visibly at three depths; wrapped lines still snap back to column 0 | MEASURED | screenshot 2026-07-25 |
| markdown checkbox list `- [x]` | WEAK | the literal ASCII `[x]` and `[ ]` survive after the `-` marker; no checkbox glyph | MEASURED | screenshot 2026-07-25 |
| strikethrough `~~x~~` | GOOD | real struck-through text, no literal tildes | MEASURED | screenshot 2026-07-25 |
| strikethrough nested inside bold (`**~~x~~**`) | NONE | the tildes print literally and the span takes the inline-code color; emphasis does not nest | MEASURED | screenshot 2026-07-25 |
| fenced code block with language tag | GOOD | syntax coloring, no border or gutter; confirmed on a powershell fence | MEASURED | screenshot 2026-07-25 |
| ```diff fence | GOOD | `+` lines green, `-` lines red, inner syntax coloring preserved | DOCUMENTED | CLI bundle, existing reply practice |
| nested blockquote `> >` | NONE | every depth collapses to the same single bar | DOCUMENTED | CLI bundle |
| link `[label](https://...)` | WEAK | renders as `label (full url)` in plain text, NOT a compact OSC 8 anchor, so the URL is never hidden; most emulators linkify the printed URL themselves (see 2b) | MEASURED | screenshot 2026-07-25 |
| `file:` links | WEAK | same shape, `label (file:///full/path)`, so the whole path stays on screen | MEASURED | screenshot 2026-07-25 |
| bare URL autolink | GOOD | linkified automatically (parser runs with gfm true) | DOCUMENTED | CLI bundle |
| `owner/repo#123` shorthand | NONE | prints as plain unstyled text with no visible link | MEASURED | screenshot 2026-07-25 |
| link reference definitions (`[a][b]` plus `[b]: url`) | NONE | the `def` tokenizer is disabled outright, so references never resolve and print as literal text | DOCUMENTED | CLI bundle |
| markdown image `![alt](src)` | NONE | printed as the text `alt (href "title")`, no picture | DOCUMENTED | CLI bundle |
| inline terminal image (sixel or iTerm2 protocol) | UNVERIFIED | an emulator feature (see 2b); whether reply text can carry the escape through the CLI renderer at all is untested | DOCUMENTED (emulator side only) | emulator docs |
| raw ANSI SGR in reply text (dim 2, underline variants 4:1 to 4:5, colored underline 58, overline 53, inverse 7, truecolor 38;2) | UNVERIFIED | capable emulators accept all of them; the CLI renderer treats html and escape tokens as raw literal text, which may or may not mean the bytes survive | DOCUMENTED (emulator side only) | emulator docs, CLI bundle |
| blink (SGR 5 and 6) | NONE | unsupported nearly everywhere, and explicitly unimplemented by xterm.js-based emulators | DOCUMENTED | emulator docs |
| HTML tags and entities | NONE | pass through as raw literal text | DOCUMENTED | CLI bundle, issue 26390 |
| footnotes `[^1]` | NONE | no footnote extension is loaded, so both the marker and the definition print literally | INFERRED | CLI bundle (marked core has no footnotes) |
| table column alignment (`:-`, `:-:`, `-:`) | GOOD | honored inside the box-bordered table; right-aligned numerics line up on their last digit | MEASURED | screenshot 2026-07-25 |
| very long tables | WEAK | a second richer table path wraps cells and caps output at 200 rows with a "N more rows not shown" line | DOCUMENTED | CLI bundle |
| inline code inside a table cell | GOOD | no bleed; the next cell keeps the default foreground | MEASURED | screenshot 2026-07-25 |
| box-drawing glyphs typed literally (U+2500 to U+257F) | GOOD | gapless and cell-aligned; tree branches and box rules both draw as continuous lines | MEASURED | screenshot 2026-07-25 |
| block element glyphs typed literally (U+2580 to U+259F) | GOOD | sparkline steps and shade ramps render as one continuous figure | MEASURED | screenshot 2026-07-25 |
| Nerd Font powerline glyphs (U+E0B0 to U+E0BF) | UNVERIFIED | font-supplied, and some emulators draw a built-in fallback for this range (see 2b) | DOCUMENTED (emulator side only) | emulator docs |
| single-codepoint emoji | GOOD | two cells wide wherever the emulator has a sane width table | DOCUMENTED | emulator docs |
| emoji with a variation selector, ZWJ sequence, or skin tone modifier | WEAK | a VS16 emoji held its cell inside a table without drifting the border; ZWJ and skin-tone sequences stay risky wherever grapheme clustering is absent | MEASURED (VS16), INFERRED (ZWJ) | screenshot 2026-07-25 |

## 2b. Emulator-dependent, varies by setup

Everything in section 2 is a property of the Claude Code renderer and travels with it. The
following are decided by the terminal emulator and its settings instead, so treat them as
local rather than universal, and never let a reply depend on one.

| behavior | what varies |
|-|-|
| color saturation | a minimum-contrast setting (VS Code calls it `minimumContrastRatio`, others have equivalents) desaturates colors until they clear a threshold, so identical output looks flatter on some setups than others |
| clickable URLs | most emulators linkify a printed URL themselves, and many open a `file:///` path on click. The renderer contributes nothing to this |
| inline images | sixel and the iTerm2 image protocol are emulator features. Even where they work, images do not survive a reload and are excluded from copy, so never put required information in one |
| raw ANSI passthrough | dim, the five underline styles, colored underlines and overline all depend on the emulator, and separately on whether the CLI renderer passes escape bytes through at all (still open) |
| Nerd Font and powerline glyphs | supplied by the font, with some emulators drawing a built-in fallback for the powerline range |
| emoji cell width | depends on the emulator's Unicode version and whether grapheme clustering is active. Single-codepoint emoji are safe; ZWJ and skin-tone sequences are not |
| blink | unsupported nearly everywhere |

## 3. UNTAPPED

Devices that render (or very likely render) and that the current reply contract does not use
at all. Ordered by value.

1. **Labeled links, with their value cut down by measurement.** DISPROVEN as originally
   written: the renderer prints `label (full url)` rather than a compact OSC 8 anchor, and
   `owner/repo#123` does not autolink at all. So a link never shortens a reply; it adds a
   label in front of the same long path. What survives is smaller: most emulators
   linkify the printed URL themselves, and many open a `file:///` path on click. Worth using
   only where the label carries meaning the path does not, never as a way to hide a path.
2. **Literal block and box glyphs for inline meters and trees.** The progress meter idiom
   already uses two of them; the full U+2580 to U+259F range gives real sparklines
   (`▁▂▃▄▅▆▇█`) and shaded bars (`░▒▓█`), and U+2500 to U+257F gives `├─` and `└─` tree
   structure. Situation it improves: multi-stream progress counters, pass/fail ratios across a
   test matrix, and file-change lists where a flat bulleted list of paths hides the directory
   shape. These are plain text to the markdown renderer, so the only open risk is glyph
   spacing.
3. **The h1 tier as a real title.** CONFIRMED: `#` renders bold plus italic plus underline
   and is the only heading with a look of its own, while `##` through `######` are one flat
   tier indistinguishable from inline bold. Situation it improves: wrap-ups, where the contract currently spends `###` on every
   section and has no stronger anchor for the reply title. Promote the top anchor to `#` and
   keep `###` for sections; do not attempt a third tier, it does not exist.
4. **Strikethrough for superseded content.** If it renders, it is the clean way to show a
   revised plan, a rejected option inside a decision table, or a before/after rename inline,
   without spending a diff fence on one word.
5. **One level of nested bullets.** Two-space indent works structurally; the catch is that
   wrapped continuation lines snap back to column 0. Situation it improves: grouping several
   short facts under one anchor noun (per-file findings under a per-area heading) where each
   child fits on one line. Keep children short or do not nest.
6. **Ordered-list depth markers.** Depth 2 rendering as `a.` and depth 3 as `i.` gives free
   sub-lettering. Situation it improves: the LETTER half of a decision-table option token
   (106a, 106b (answer keys): the question's number and the option's letter) could
   be generated by the list itself when a Needs-you item has sub-options. The number half is
   the question's own and no list marker supplies it, so this buys less than it did when the
   whole token was two characters.
7. **Table column alignment.** Right-aligning numeric columns makes count tables scannable.
   Cheap to adopt if T10 confirms it survives the box-bordered path.
8. **Blockquote for verbatim quoting.** Currently reserved for the single load-bearing
   warning. It also italicises its body, which makes it a good frame for quoting an error
   message or the user's own earlier words, and a bad frame for paths or commands.

## 4. DEAD ENDS

Do not propose these again.

- **A third heading tier.** h2 through h6 are indistinguishable. Two tiers maximum.
- **Nested blockquote depth.** Every level draws the same single bar.
- **HTML of any kind.** `<br>`, `<details>`, `<sub>`, `&nbsp;` all print literally.
- **Link reference definitions.** The renderer disables the `def` tokenizer, so `[a][b]` plus
  `[b]: url` can never resolve. Inline links only.
- **Footnotes.** No extension is loaded; markers and definitions print as literal text.
- **Blink.** Mainstream emulators do not implement SGR 5 or 6.
- **A full-width horizontal rule.** The renderer emits the literal string `---` and is not
  width-aware. The fold rule will always be three characters. (A row of literal box-drawing
  characters is a separate device and may work, see T13.)
- **Long or multi-line nested list items.** Wrapped lines return to column 0, so the nesting
  is visually destroyed by the first wrap.
- **Bold as a color or contrast device.** The default foreground never brightens. Weight is
  the only signal bold carries.
- **Checkbox glyphs.** At best `[x]` and `[ ]` survive as literal ASCII; there is no rendered
  checkbox.
- **Markdown images.** `![alt](src)` prints as text, always.
- **Terminal images as load-bearing content.** Even where the escape passes through, images do
  not survive a terminal reload, are excluded from copy-as-HTML, and break below sub-cell
  height. Never put required information in one.
- **Multi-codepoint emoji inside tables.** ZWJ sequences and skin-tone modifiers mis-measure
  and drift columns. (Variation-selector emoji such as the warning sign are common in the
  anchor palette and carry the same risk, which is what T12 measures.)
- **Assuming a stored file can carry raw ANSI.** Escape bytes have to be produced at send
  time; they do not survive as document text.

## 5. RESOLVED AND STILL OPEN

Settled by the test-card screenshot of 2026-07-25:

- `#` is distinct (bold, italic, underline); `###` is bold only, identical to inline bold.
- strikethrough renders for real.
- `[x]` and `[ ]` survive as literal ASCII, no checkbox glyph.
- nesting indents cleanly at three depths.
- depth markers cycle `1.` `a.` `i.` `1.`, one level earlier than predicted.
- links print as `label (url)`, no compact anchor; the issue shorthand does not link.
- table alignment is honored, including right-aligned numerics.
- no inline-code color bleed between cells.
- a VS16 emoji held its column inside the table.
- box and block glyphs render gapless and cell-aligned.
- syntax coloring works on an uncommon fence language.

Still open:

- whether raw ANSI escape bytes survive the CLI renderer. This one cannot be tested from a
  stored file; the bytes have to be emitted at send time, and it is unclear whether the model
  can emit a literal 0x1B through the API layer at all. Until it is settled, treat dim, the five
  underline styles, colored underlines and overline as unavailable.

## 6. TEST CARD

Send the block below verbatim as one reply, then screenshot it. Every label maps to an open
question above. T14 cannot be stored in a file (it needs literal escape bytes) so it is
described here and must be substituted at send time.

```markdown
# T1 h1 title tier
### T2 h3 section tier, next to **plain bold body text** for comparison

T3 strike: ~~superseded plan~~ current plan

T4 markdown checkbox list:
- [x] completed item
- [ ] open item

T5 nesting:
- parent bullet
  - child bullet
    - grandchild bullet

T6 ordered depth markers:
1. depth zero
   1. depth one
      1. depth two, expect a.
         1. depth three, expect i.

T7 labeled link: [example label](https://example.com)
T8 file link: [open a local file](file:///path/to/any/local/file.md)
T9 issue shorthand: example/repo#1

T10 alignment, T11 code bleed, T12 emoji width:
| left col | center col | right col |
|:-|:-:|-:|
| `inlinecode` | nextcell | 1234 |
| plain | plain | 7 |
| VS16 emoji ✔️ | single cp 🐛 | 42 |

T13 glyphs:
├─ meter ▰▰▰▱▱  spark ▁▂▃▄▅▆▇█  shade ░▒▓█
└─ box ┌─┬─┐ │ ├─┼─┤ └─┴─┘

T15 fence with an uncommon language:
```powershell
$path = "C:\Projects\example"; Get-ChildItem $path | Select-Object -First 2
```
```

T14, substitute real escape bytes at send time (one line, outside any fence):
emit `ESC[2m dim ESC[0m` then `ESC[4:3m curly underline ESC[0m` then
`ESC[4m ESC[58;5;196m red underline ESC[59m ESC[0m` then `ESC[53m overline ESC[0m`,
where `ESC` is the literal 0x1B byte. If those render as styled text, raw SGR passthrough
works and the whole modern-emulator attribute set (dim as a third weight tier, five underline styles,
independently colored underlines, overline, truecolor) becomes available to the contract. If
they render as visible `[2m` garbage, mark raw ANSI a dead end permanently.
