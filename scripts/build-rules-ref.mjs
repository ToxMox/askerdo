/* docs/guide/reply-rules.md: every reply rule explained with an example. The
 * numbering, the palette, the per-surface lines and what each setting does to
 * the rules come from lib/builder.js at the built-in settings, so the page
 * cannot drift; a rule no card matches fails the build. */
import { buildOutputStyle, buildSurfaceSection, paletteRows } from '../lib/builder.js';
import { DEFAULT_CONFIG } from '../lib/node-helpers.mjs';
import { SETTINGS, PC_SETTINGS } from '../server/verbs/profile-rules.mjs';

const BASE = { ...DEFAULT_CONFIG, custom: [] };

const FAMILIES = [
  ['Anchors', 'Where your eye lands: line 1, the footer, the question queue, the counts and the input labels.'],
  ['Structure', 'How a reply is shaped, from its length to its tables.'],
  ['Devices', 'Pictures, widgets and the pop-up dialog.'],
  ['Text hygiene', 'What never appears in anything Claude writes.'],
];

/* A card per rule; {n:id} in its text is that rule's number at the built-in settings. */
const CARDS = [
  {
    id: 'bottomline', family: 'Anchors', match: /^Bottom line first\./, title: 'Bottom line first',
    text: [
      "Line 1 opens with the anchor cluster (the [palette](#the-anchor-palette) glyphs), then the outcome or the ask, in bold. Context never leads: no warm-up (\"Let me...\") opens a reply, and no closing recap repeats what it already said. Every line speaks to you in the second person.",
      '',
      'The cluster is a strong default, not a mandatory prefix: ordinary conversation and one-line answers skip it.',
    ],
    example: [
      '> 🔎 ☀️ 🟢 **The leak is in the pool: sockets are never returned on timeout.**',
      '>',
      '> Explanation and evidence follow. They never lead.',
    ],
  },
  {
    id: 'footer', family: 'Anchors', match: /^The footer/, title: 'The footer: four states, always last',
    text: [
      'The footer is the last section of a substantive reply, never a question buried in the middle, and its state always agrees with the FORECAST glyph on line 1. Claude picks the state by running the checks in order, first match wins:',
      '',
      '- 🙋 **Needs you:** an ask in this reply, a go-gate (a next step that starts only on your word), or an open question waiting on you.',
      '- 🔜 **Nothing needed yet:** a decision is coming at the next step or the one after.',
      '- 🟢 **Next up:** nothing is needed from you, and the footer says what runs next.',
      '- 🏁 **Done:** the arc is closed and no next step is worth recommending anywhere.',
      '',
      'A question is told in full exactly once: the ask, short stakes, whether it blocks work, and the option tokens with what each does. Everything else outstanding waits in the question queue (rule {n:queue}). Going unanswered decides nothing: a blocking question keeps its work blocked, and a default is only ever a proposal you accept.',
      '',
      'Only 🟢 may skip the footer, on a short reply whose body already says what is next, so a missing footer is itself a claim that nothing is outstanding. A session that closes on a handoff gives you `/askerdo resume TR-n` in a copy block just above the footer, and its hand stays down.',
    ],
    example: [
      '> 🙋 **Needs you:** Q1 (flag name): rename the flag before release (1a, my pick) or keep it (1b)? It blocks the tag.',
      '',
      '> 🔜 **Nothing needed yet:** the flag-name call comes when CI goes green.',
      '',
      '> 🟢 **Next up:** the soak test runs unattended; results follow when it reports.',
      '',
      '> 🏁 **Done.**',
      '>',
      '> 💤 **Later, if you want:** a dark-mode pass on the dashboard.',
    ],
  },
  {
    id: 'queue', family: 'Anchors', match: /^The question queue\./, title: 'The question queue',
    text: [
      'Every open question has one home, so a reply never retells one. In text mode (the built-in queue) a question still unanswered when a later message is written becomes a markdown file under `.claude/questions/<session-id>/` in the project; files never move, so old links keep working, and an index lists the open set. On a board, every question registers with the board when it is asked, keeps its id in every session and on every PC, and an answer given anywhere (the band, a card, `/askerdo 106b`, another session) reaches the session that asked.',
      '',
      'A reply with questions open ends with the names line, a count and the questions by name, blockers first. Where the AskerDo mod runs, the band above your prompt carries the queue instead, and replies write no names line. An answer that settles a lasting decision is recorded as a decision record on the board, or a `docs/` note in text mode, never in Claude\'s auto memory.',
    ],
    example: [
      '> ❓ **5 open questions**: Q4 (store shape) · Q7 (bar cadence) · Q9 (tag glyph) and 2 more',
      '',
      'The count and each name are links: to the question files and their index in text mode, to the board\'s pages on a board.',
    ],
  },
  {
    id: 'counts', family: 'Anchors', match: /^Multi-part work/, title: 'Counts and progress lists',
    text: [
      'Work in several parts carries a count led by ⏳, and an arc of three or more steps becomes a list led by palette glyphs: ✅ done, ⏳ running, ❌ failed. Nothing is struck through or dimmed, so every line stays readable. A markdown checkbox list is right only when you want items visibly checked off. Block glyphs cover what a list cannot: `▁▂▃▄▅▆▇█` for a trend and `░▒▓█` for a proportion.',
    ],
    example: [
      '> ⏳ 2 of 4 streams done',
      '>',
      '> - ✅ schema migrated',
      '> - ✅ index rebuilt',
      '> - ⏳ backfill running',
      '> - ❌ parity check failed',
      '>',
      '> latency ▁▂▄▇▅▃▁ · coverage ▓▓▓░░',
    ],
  },
  {
    id: 'input', family: 'Anchors', match: /^Anything .* must type or click/, title: 'Input labels',
    text: [
      'Anything you must type or click sits alone in a fenced block with its literal inputs labeled, under a label line that starts with ⬇️. A command uses the syntax of the shell you paste it into, not the session\'s own tools: PowerShell 7 on Windows, tagged `powershell`, and `bash` elsewhere. One command per block, no leading `$` and no output mixed in, because that is what earns the desktop app\'s Run button (in its main window; a session opened in a separate window shows none).',
    ],
    example: [
      '> ⬇️ Run this to restart the service (paste as is):',
      '>',
      '> ```powershell',
      '> beaconctl restart --profile default',
      '> ```',
    ],
  },
  {
    id: 'length', family: 'Structure', match: /^Length is guidance/, title: 'Length is guidance, not a box',
    text: [
      'Replies aim short: a simple question gets one to three sentences, a status update a few lines, a wrap-up about a screenful. Never at the cost of load-bearing information: detail you ask for is answered in full, and error reports, failing test output, security warnings and confirmations for destructive actions keep their complete content. Hedging boilerplate goes, and a caveat appears only when it changes what you should do next.',
      '',
      'Reference material (long logs, full tables) goes in a local file under `docs/`, linked so one click opens it in a pane, with a two or three line digest in the reply. A published artifact leaves your machine, so Claude reaches for one only when you ask for something to share.',
    ],
    example: [
      '> **Profiler sweep done: the hot path is the locale lookup.**',
      '>',
      '> The full 200-row trace is in [reports/sweep.md](#); the line above is what you decide on.',
    ],
  },
  {
    id: 'bullet', family: 'Structure', match: /^One topic per bullet/, title: 'One topic per bullet',
    text: [
      'Two or more parallel things (findings, causes, changes, trade-offs) become bullets, one topic each with a bold lead noun, never one welded paragraph. Prose is for a single argument that has to flow. Bullets nest one level where a point carries sub-points, two only for a real tree. A reply describes the final state, not the journey: no retelling of your request, the plan or the attempts, just outcomes, decisions and what you must act on.',
    ],
    example: [
      '> - **Cache key** now includes the locale; the collisions are gone.',
      '> - **Flush endpoint** added behind the admin scope.',
      '>   - Old callers keep working; the unscoped route returns 410.',
    ],
  },
  {
    id: 'ids', family: 'Structure', match: /^IDs carry names\./, title: 'IDs carry names',
    text: [
      'An ID (Q1, T-1043, an issue number) is a lookup key, not a name: bare, it sends you scrolling back to remember what it was. So every mention carries its short human name, in prose, tables, footers and card text alike, with a plain gloss the first time when the name alone is jargon; an ID with no name yet gets a short hook, coined once and reused. Inside one paragraph about one ID the name may drop after its first mention there.',
      '',
      'Internal codes get the same treatment: a run id, a lane or agent handle, a revision tag or a budget number gets a plain name in the same breath or gives way to a plain description. Agents are named by their job, and a commit hash stays only as a click target.',
    ],
    example: [
      '> **Bad:** Q3 and #212 are still open.',
      '',
      '> **Good:** Q3 (source cleanup) and #212 (fold head cuts a long title) are still open.',
    ],
  },
  {
    id: 'markdown', family: 'Structure', match: /^Use the markdown/, title: 'Structural markdown',
    text: [
      'Headings anchor wrap-ups and replies with several topics (status updates stay headerless): `#` is the loud anchor and `##` the quiet gray one, while `###` looks like bold body text, so there are two tiers. Tables hold enumerable facts with numeric columns right-aligned; a table spans the full pane, so two thin columns read as mostly whitespace. Every fenced block names its language, and one `> ⚠️` blockquote holds the load-bearing warning when there is one. Bold marks a bullet\'s lead noun, not emphasis mid-sentence, and `~~strikethrough~~` marks superseded content.',
      '',
      'Code changes come as short `` ```diff `` snippets, since the diff viewer is the real review surface, and a pass or fail readout is a glyph-led list instead. Checkbox lists and footnotes render for real. Numbered lists are for true sequences. File paths are links, never pasted: one click opens the file pane, and the path is written from the working directory, since a `~/...` or absolute path does not resolve. HTML tags print literally.',
    ],
    example: [
      'As Claude writes it, each part rendered by the app:',
      '',
      '````markdown',
      '# What changed',
      '',
      '## Parser',
      '',
      '- **Parser core** rewritten; old paths removed, see [grammar.rs:88](src/grammar.rs:88).',
      '',
      '- [x] fixtures regenerated',
      '- [x] old fixtures archived',
      '',
      '|gate|result|slowest case|',
      '|-|-:|-|',
      '|unit|212 of 212|38 ms, parser_roundtrip|',
      '',
      '> ⚠️ Converter not landed; old saves do not round-trip yet.',
      '',
      '```diff',
      '- let tokens = self.buffer.fill().collect();',
      '+ let tokens = self.stream().parse_incremental();',
      '```',
      '````',
    ],
  },
  {
    id: 'fold', family: 'Structure', match: /^The fold\./, title: 'The fold',
    text: [
      'Past roughly a screenful, one lone `---` rule separates what you must read (above) from optional reference depth (below). Nothing load-bearing ever sits below the fold, so stopping there is always safe. Wrap-ups keep one fixed order so your eye knows where to jump: line 1, progress counts, what changed, verification, the fold and its detail, the footer last.',
    ],
    example: [
      '> **The must-read summary lives here.**',
      '>',
      '> ---',
      '>',
      '> Optional depth: internals, log digests, long tables. Skippable by construction.',
    ],
  },
  {
    id: 'decision', family: 'Structure', match: /^Decision tables\./, title: 'Decision tables',
    text: [
      'Each question is its own block: the question line, a one-line crux (the fact that decides it), then its options as a small table (type, option, what happens, catch), the pick starred on its row and a choice that is hard to undo marked one-way in its catch. The question line is the ask: one plain question ending in a question mark that names the options inline with their tokens and the pick. Never options before the ask, and never two questions in one table.',
      '',
      'The type cell is the token you answer with, the question\'s number and the option\'s letter (106a, 106b), so it names its question wherever it is read or typed. Free-form answers stay welcome.',
    ],
    example: [
      '> **Q106 (store move):** migrate the store now (106a, my pick) or defer it (106b)?',
      '>',
      '> Crux: the next release reads only the new store.',
      '>',
      '> |type|option|what happens|catch|',
      '> |-|-|-|-|',
      '> |`106a *`|migrate now|one-time bake, then done|one-way|',
      '> |`106b`|defer|no work now|the debt remains|',
    ],
  },
  {
    id: 'tiers', family: 'Structure', match: /^Reply tiers/, title: 'Reply tiers, and judgment above them',
    text: [
      '**Tier 1, a one-liner:** a direct answer with nothing pending gets the answer alone, no cluster and no footer. **Tier 2, short:** the cluster, a bold bottom line and bullets when the content is a set, with no headings and no fold; the footer follows rule {n:footer}, so a short 🟢 reply whose body already says what is next may end without one. **Tier 3, substantive:** the full skeleton. When the tier is unclear, Claude goes up rather than down.',
      '',
      'Above all of it sits judgment: these are defaults, not a cage, and content is never contorted to fit them.',
    ],
    example: [
      'Tier 1:',
      '',
      '> Port 5000.',
      '',
      'Tier 2:',
      '',
      '> ✅ ☀️ 🟢 **Cache warmed; the 404s are gone.**',
      '',
      'Tier 3 is the full skeleton: headings, the fold and the footer included.',
    ],
  },
  {
    id: 'visual', family: 'Devices', match: /^Draw the shape\./, title: 'Draw the shape',
    text: [
      'A structure (branching, cycles, a state flow, three or more parts that interact, a before and after) is drawn, not prosed: on the desktop app an inline diagram widget or a figure saved to disk carries the shape, and prose carries the verdict, never both in full. Comparisons and trends get real charts. A short linear run stays prose, since a picture that only decorates is noise. When you ask how something works, the answer goes picture first with a short walk through it. Without the drawing tools, outside the desktop app, replies fall back to text devices such as sparklines and shallow trees.',
    ],
    example: [
      'An inline diagram widget draws the real boxes and arrows in the reply, and the text under it keeps the verdict:',
      '',
      '> **Verdict:** the retry loop is the bottleneck.',
    ],
  },
  {
    id: 'interactive', family: 'Devices', match: /^Interactive devices\./, title: 'Interactive widgets and forms',
    text: [
      'Sliders and live controls serve teaching and what-if exploration; clickable forms collect structured input, and a form\'s submit arrives as an ordinary chat message. A decision rich enough to want icons or previews gets widget buttons, and one where a typed token is quicker keeps the plain decision table. Interaction has to earn its place, and these widgets exist only where the drawing tools do, on the desktop app.',
    ],
    example: [
      'A form widget\'s submit lands in the chat as:',
      '',
      '> Probe details - Render status: All rendered',
    ],
  },
  {
    id: 'dialog', family: 'Devices', match: /AskUserQuestion dialog/, title: 'The AskUserQuestion dialog',
    text: [
      'When the pop-up question dialog may appear follows the Pop-up questions setting: only for a decision that blocks work mid-turn (built in), whenever a small set of options fits, or never. A plugin hook enforces a ban live, with no settings edit. Everything else waits for the footer and its decision tables.',
    ],
    example: [
      '> Blockers only: the dialog interrupts once for "which schema do I migrate?", while preference questions wait in the footer.',
    ],
  },
  {
    id: 'emdash', family: 'Text hygiene', match: /^NO EM-DASHES/, title: 'No em or en dashes, anywhere',
    text: [
      'Neither dash appears in anything Claude writes: replies, code, comments, docs, commit messages, issue bodies. A plain hyphen, a comma, parentheses, a colon or a new sentence does the job. Both glyphs are banned from this page too, so the bad examples spell them out.',
    ],
    example: [
      '> **Bad:** Fixed the parser (em dash) mostly. Pages 4 (en dash) 7 rebuilt.',
      '',
      '> **Good:** Fixed the parser, mostly. Pages 4-7 rebuilt.',
    ],
  },
  {
    id: 'time', family: 'Text hygiene', match: /^No time estimates/, title: 'No time estimates',
    text: [
      'No time estimates and no time-of-day remarks; a reply frames the work on risk and outcome instead.',
    ],
    example: [
      '> **Bad:** Should take about two hours this afternoon.',
      '',
      '> **Good:** Low risk: the converter is covered by fixtures, so a bad landing is caught before release.',
    ],
  },
];

/* GitHub's heading anchor */
const anchor = (h) => h.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-');
const andJoin = (xs) => xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];

/* The numbered rules of the contract built from o, each matched to its card. */
function rulesOf(o) {
  const body = buildOutputStyle(o);
  const from = body.search(/^1\. /m);
  const to = body.indexOf('\n\n### Anchor emoji palette');
  const rules = body.slice(from, to).split(/\n(?=\d+\. )/).map((r) => r.replace(/^\d+\. /, ''));
  const out = new Map();
  rules.forEach((text, i) => {
    const hits = CARDS.filter((c) => c.match.test(text));
    if (hits.length !== 1) throw new Error('scripts/build-rules-ref.mjs has ' + hits.length + ' cards for rule ' + (i + 1) + ': ' + text.slice(0, 60));
    out.set(hits[0].id, { n: i + 1, text });
  });
  return { body, rules: out };
}

const slots = (o) => new Set(paletteRows(o).map((r) => r.split('|')[1].replace(/^\d+ /, '')));

/* Each reply setting that changes the contract, and what each value it can take does. */
function settingEffects(base) {
  const rows = [];
  const all = [...Object.entries(SETTINGS).filter(([, s]) => s.contract), ['queue', PC_SETTINGS.queue]];
  for (const [key, s] of all) {
    if (s.kind !== 'bool' && s.kind !== 'choice') continue;
    const cfgKey = key.replace(/^contract\./, '');
    const values = s.kind === 'bool' ? [!s.def] : s.values.filter((v) => v !== s.def);
    const effects = values.map((v) => {
      const o = { ...BASE, [cfgKey]: v };
      const got = rulesOf(o);
      const dropped = [...base.rules.keys()].filter((id) => !got.rules.has(id));
      const reworded = [...base.rules.keys()].filter((id) => got.rules.has(id) && got.rules.get(id).text !== base.rules.get(id).text);
      const before = slots(BASE);
      const after = slots(o);
      const gone = [...before].filter((x) => !after.has(x));
      return { v, word: s.kind === 'bool' ? (v ? 'On' : 'Off') : '`' + v + '`', dropped, reworded, gone, other: got.body !== base.body };
    });
    rows.push({ key, s, link: 'settings-and-rules.md#' + (s.pc ? 'this-pc' : 'replies'), effects });
  }
  return rows;
}

export function rulesPage() {
  const base = rulesOf(BASE);
  for (const c of CARDS) if (!base.rules.has(c.id)) throw new Error('scripts/build-rules-ref.mjs card ' + c.id + ' matches no rule at the built-in settings');
  const ordered = [...base.rules.entries()];
  const titleOf = (id) => {
    const c = CARDS.find((x) => x.id === id);
    return base.rules.get(id).n + '. ' + c.title;
  };
  const ruleLink = (id) => 'rule ' + base.rules.get(id).n + ' ([' + CARDS.find((x) => x.id === id).title + '](#' + anchor(titleOf(id)) + '))';
  const ruleLinks = (ids) => (ids.length > 1 ? 'rules ' : 'rule ') + andJoin(ids.map((id) => ruleLink(id).replace(/^rule /, '')));
  const fill = (lines) => lines.join('\n').replace(/\{n:(\w+)\}/g, (m, id) => {
    if (!base.rules.has(id)) throw new Error('scripts/build-rules-ref.mjs points at a rule the contract lacks: ' + id);
    return String(base.rules.get(id).n);
  });
  const effects = settingEffects(base);

  /* the settings line under a card: what drops it, and which choices reword it */
  const cardSettings = (id) => {
    const parts = [];
    for (const r of effects) {
      const drops = r.effects.filter((e) => e.dropped.includes(id));
      const rewords = r.effects.filter((e) => e.reworded.includes(id));
      const head = '[' + r.s.label + '](' + r.link + ') (`' + r.key + '`)';
      if (r.s.kind === 'bool' && drops.length) parts.push(head + ' off drops this rule');
      else if (r.s.kind === 'choice' && (drops.length || rewords.length)) {
        const bits = [];
        if (rewords.length) bits.push(andJoin(rewords.map((e) => e.word)) + (rewords.length > 1 ? ' reword' : ' rewords') + ' this rule');
        if (drops.length) bits.push(andJoin(drops.map((e) => e.word)) + ' drops it');
        parts.push(head + ': ' + bits.join(', '));
      }
    }
    return parts.length ? '**Setting:** ' + parts.join('; ') + '.' : '';
  };

  const out = [
    '<!-- Generated by node scripts/build.mjs from lib/builder.js at the built-in settings, with the explanations and examples in scripts/build-rules-ref.mjs. Edit those, never this file. -->',
    '',
    '# Reply rules',
    '',
    'AskerDo writes a reply contract into Claude Code as a user-scope output style, `~/.claude/output-styles/askerdo.md`, so every session on your PC, in every project, replies to you the same way: the outcome first, a few fixed glyphs that say how things stand, and what Claude needs from you always last. This page explains each rule and shows what it looks like in a reply. The examples under each rule are invented.',
    '',
    'A reply at the built-in settings, from a session on a small demo project:',
    '',
    '![A reply: the anchor emoji and a bold bottom line, a code block, four bulleted findings and a Needs you footer](../img/readme/reply.png)',
    '',
    'The same request in two sessions, to plan a `--units` flag for a small command line tool, one on Claude Code\'s built-in Concise output style and one on AskerDo:',
    '',
    '|Concise output style|AskerDo|',
    '|-|-|',
    '|![The plain session\'s plan: a paragraph, headings and numbered code changes, with no status line and no footer](../img/readme/plan-concise.png)|![The AskerDo session\'s plan: the anchor emoji and a bold bottom line, the plan in bullets, the expected output and a Needs you footer naming what a go starts](../img/readme/plan-askerdo.png)|',
    '',
    'At the built-in settings the contract has ' + ordered.length + ' rules in four families. The number on each rule is its place in that list: switching a rule off in [Settings and rules](settings-and-rules.md) drops it, and the rules after it move up. [Which settings change the rules](#which-settings-change-the-rules) lists every switch.',
    '',
    '## Why it works',
    '',
    '- **Fixed anchors.** The same information always lives in the same place: line 1 carries the mood, the progress line the count, and what Claude needs from you is always the last thing, so your eye learns coordinates instead of rescanning prose.',
    '- **Reserved meanings.** Each palette glyph has exactly one meaning, so reading a reply becomes recognition rather than comprehension.',
    '- **Traffic-light color.** Green means walk away, amber means attention, red means blocked: judgments your eye makes before conscious reading starts.',
    '- **A closed palette.** One meaning per glyph is what makes it scannable, not rarity: an anchor may appear again further down at exactly the same meaning, but no second glyph ever competes for a meaning already taken.',
    '',
    '## The anchor palette',
    '',
    'Line 1 opens with up to three glyphs, one per slot, in a fixed order: STATUS (what happened), WEATHER (how the overall effort is going) and FORECAST (whether you will be needed). The same glyphs appear in tables and prose at exactly their palette meaning, and nowhere in file content.',
    '',
    '|Slot|Emoji|Meaning|',
    '|-|-|-|',
    ...paletteRows(BASE),
    '',
    '⚠️ also marks the single load-bearing warning blockquote (`> ⚠️ ...`) when there is one.',
  ];

  for (const [family, lede] of FAMILIES) {
    out.push('', '## ' + family, '', lede);
    for (const [id] of ordered) {
      const c = CARDS.find((x) => x.id === id);
      if (c.family !== family) continue;
      out.push('', '### ' + titleOf(id), '', fill(c.text), '', fill(c.example));
      const line = cardSettings(id);
      if (line) out.push('', line);
    }
  }

  /* a fence opener named mid-line becomes a code span, so GitHub shows it as code */
  const surface = (which) => buildSurfaceSection(BASE, which).split('\n').filter((l) => l.startsWith('- '))
    .map((l) => l.replace(/(^|[^`])```(\w+)/g, '$1`` ```$2 ``'));
  out.push(
    '', '## On the desktop app', '',
    'The rules above are measured against the Claude Code desktop app ([what it draws](../desktop-capabilities.md)), and the contract adds these lines for it:',
    '', ...surface('desktop'),
    '', '## On the terminal and anywhere else', '',
    'In the terminal, an editor extension, over SSH or headless, the renderer is narrower, and where one of these lines and a numbered rule disagree, the line wins ([what the terminal draws](../tui-capabilities.md)):',
    '', ...surface('terminal'),
    '', 'Claude tells the two apart by its own tools: artifact publishing, the Browser pane and inline widgets mean the desktop app. Without them, or when it cannot tell, it follows the terminal lines, the stricter set.',
    '', '## Where the AskerDo mod runs', '',
    'In a session running the AskerDo mod, the contract gains a section of its own: questions asked through the `ask` tool and drawn as cards under the reply, the band above your prompt carrying the queue in place of a names line, the `/askerdo` commands, handoffs, and rulings recorded as you make them. [Daily use](daily-use.md) shows each.',
    '', '## Which settings change the rules', '',
    'Each reply setting that changes a rule, and what switching it does. [Settings and rules](settings-and-rules.md) says where each is set.',
    '', '|Setting|Key|What changing it does|', '|-|-|-|',
  );
  const quiet = [];
  for (const r of effects) {
    /* values with the same effect share one sentence */
    const said = new Map();
    for (const e of r.effects) {
      const bits = [];
      if (e.dropped.length) bits.push('drops ' + ruleLinks(e.dropped));
      if (e.reworded.length) bits.push('rewords ' + ruleLinks(e.reworded));
      if (e.gone.length) bits.push('takes ' + andJoin(e.gone) + ' out of the palette');
      const what = bits.join('; ');
      if (what) said.set(what, [...(said.get(what) || []), e.word]);
    }
    const plural = (what) => what.replace(/^(drops|rewords|takes)|; (drops|rewords|takes)/g, (v) => v.slice(0, -1));
    if (said.size) out.push('|[' + r.s.label + '](' + r.link + ')|`' + r.key + '`|' + [...said].map(([what, words]) => andJoin(words) + ' ' + (words.length > 1 ? plural(what) : what) + '.').join(' ') + '|');
    else quiet.push('[' + r.s.label + '](' + r.link + ') (`' + r.key + '`)' + (r.effects.some((e) => e.other) ? " changes only the contract's opening note" : ' changes nothing in the rules'));
  }
  out.push(
    '',
    'Your own rules (`contract.custom`) join the list word for word after rule ' + ordered.length + '.'
      + (quiet.length ? ' ' + andJoin(quiet) + '.' : ''),
    '', '## Related', '',
    '- [Settings and rules](settings-and-rules.md): every setting, where its value comes from and how to change it.',
    '- [Getting started](getting-started.md): installing the plugin and setting up your replies.',
    '- [Daily use](daily-use.md): the band, the status line and the pane where the mod runs.',
  );
  return out.join('\n') + '\n';
}
