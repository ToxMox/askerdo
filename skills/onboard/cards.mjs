/* a routine row (survey.mjs, find routine) as a procedure card file in the shape of
   docs/procedures/README.md, for the handover to write. cardText is pure; writeCard writes
   docs/procedures/<name>.md under a repo folder. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { commandScripts } from '../../lib/procedures.mjs';

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const clip = (s, n) => { const t = oneLine(s); return t.length > n ? t.slice(0, n - 3) + '...' : t; };
const plain = (s) => oneLine(String(s).replace(/`[^`]*`/g, ' ').replace(/\*\*|__/g, ''));
/* the README's YAML rule: quote a value with ": " or " #", or one starting with a quote, backtick, bracket or sigil */
const yaml = (v, inList) => (/: | #|^[`'"[{*&!|>%@-]|^\s|\s$/.test(v) || (inList && /[,\]]/.test(v)) ? JSON.stringify(v) : v);
const yamlList = (xs) => '[' + xs.map((x) => yaml(x, true)).join(', ') + ']';
const RUNNER = /^(npm|npx|node|git|python3?|pip|cargo|go|make|dotnet|bash|sh|pwsh|powershell|yarn|pnpm|uv|docker|claude)\s+\S/;
/* a runner or a script with its arguments: a bare path or a word like `node-catalog.json` is named, never run,
   and a script with no flag runs only when it can stand alone (`tools/x.py some_function` names a place) */
const isCommand = (s) => {
  const t = s.trim();
  return /\s/.test(t) && (RUNNER.test(t) || (commandScripts(t).length > 0 && (/^\.{0,2}\/|\s-{1,2}[A-Za-z]/.test(t) || /^\S+\.(sh|ps1|cmd|bat|exe)\s/i.test(t))));
};
/* an MCP tool is called, never typed into a shell */
const TOOL = /^mcp__[\w-]+$/;
/* a text ends punctuated when its last word does, a closing bracket or quote after it included ("check.)") */
const ENDED = /[.!?;:]["')\]]*$/;
/* a text's lines, each with whether it sits in a fence, read as lib/procedures.mjs reads fences; and the fence left open */
function fenced(s) {
  let open = null;
  const lines = String(s).split('\n').map((l) => {
    const f = /^(`{3,}|~{3,})\s*([A-Za-z0-9_-]*)/.exec(l);
    if (open) { if (f && !f[2] && l.trim().startsWith(open)) open = null; return { l, code: true }; }
    if (f) { open = f[1]; return { l, code: true }; }
    return { l, code: false };
  });
  return Object.assign(lines, { open });
}
/* the single-line code spans of a text, its fenced blocks aside */
const ticks = (s) => [...fenced(s).filter((x) => !x.code).map((x) => x.l).join('\n').matchAll(/`([^`\n]+)`/g)].map((m) => m[1].trim());
/* a step's lines in the card: a line that would open a heading is indented out of it, and a fence left open is closed */
function stepBody(s) {
  const ls = fenced(s);
  return [...ls.map((x) => (!x.code && /^\s{0,3}#/.test(x.l) ? '    ' + x.l.trimStart() : x.l)), ...(ls.open ? [ls.open] : [])];
}
/* a heading past this many characters ends at its first comma or bracket (39 of 273 Tidewatch steps ran past 100) */
const HEAD_MAX = 80;
/* a step's heading and the text after it: the first line's words up to ": " or a sentence end, outside code and
   brackets, taken verbatim with its mark so heading and body fold back to the step's words (coverage reads them so) */
function headOf(s) {
  const ls = String(s).split('\n');
  const at = ls.findIndex((l) => l.trim());
  if (at < 0 || fenced(s)[at].code) return { head: '', rest: String(s) };
  const line = ls[at];
  let tick = false;
  let depth = 0;
  let end = line.length;
  let cut = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '`') tick = !tick;
    else if (tick) continue;
    else if (c === '(' || c === '[') { if (!depth && cut < 0 && i >= 20) cut = i; depth++; }
    else if ((c === ')' || c === ']') && depth) depth--;
    else if (!depth && c === ',' && cut < 0 && i >= 20) cut = i + 1;
    else if (!depth && /[:.!?]/.test(c) && /^(\*\*)?["')\]]*(\s|$)/.test(line.slice(i + 1))) { end = i + 1 + /^(\*\*)?["')\]]*/.exec(line.slice(i + 1))[0].length; break; }
  }
  if (end > HEAD_MAX && cut > 0 && cut < end) end = cut;
  const rest = [line.slice(end).trim(), ...ls.slice(at + 1)];
  return { head: line.slice(0, end).trim(), rest: (rest[0] ? rest : rest.slice(1)).join('\n') };
}
/* a step's text as written: one line folded, several kept as lines (code among them) */
const asWritten = (s) => { const ls = String(s ?? '').replace(/\r/g, '').trim().split('\n').map((l) => l.trimEnd()); return ls.length > 1 ? ls.join('\n') : oneLine(ls[0]); };
const VERBS = 'Add|Clear|Compare|Compress|Convert|ConvertFrom|ConvertTo|Copy|Disable|Enable|Expand|Export|ForEach|Format|Get|Group|Import|Invoke|Join|Measure|Move|New|Out|Pop|Push|Read|Register|Remove|Rename|Resolve|Restart|Select|Set|Sort|Split|Start|Stop|Tee|Test|Update|Wait|Where|Write';
/* a line runs in PowerShell when it holds a cmdlet anywhere, the call operator, $env:, a backslash drive path or an exe's slash flags */
const PS = new RegExp('\\.ps1\\b|^(pwsh|powershell)\\b|^&\\s|\\b(' + VERBS + ')-[A-Z][A-Za-z]+\\b|\\$env:|\\b[A-Za-z]:\\\\|\\s/[A-Z?][A-Z]*(\\s|$)');
const fenceOf = (cmd) => (PS.test(cmd) ? 'powershell' : 'sh');
/* a generic program by itself (curl, git, MSBuild.exe, wpr) is never a trigger or a reference: it fires every card that runs it */
const GENERIC = new Set(('7z bash bun cargo cat cl clang cmake cmd code curl deno devenv docker dotnet echo explorer find findstr gcc gh git go gradle grep '
  + 'java jq logman ls make msbuild mvn netsh node npm npx nuget perl php pip pip3 pnpm powershell pwsh py pytest python python3 reg robocopy '
  + 'rsync ruby scp sed sh ssh tar taskkill tasklist tracerpt typeperf unzip uv wget winget wpa wpaexporter wpr xcopy xperf yarn zip zsh').split(' '));
const isProgram = (t) => { const w = oneLine(t); return !/[\s/\\]/.test(w) && GENERIC.has(w.toLowerCase().replace(/\.(exe|com|cmd|bat)$/, '')); };
const pathy = (t) => !/\s/.test(t) && !/[<>$*?%]/.test(t) && !/^[A-Za-z]:|^\/|^~|^https?:|^\d/.test(t) && (t.includes('/') || /\.[a-z][a-z0-9]{0,4}$/i.test(t));

/* Sentences of the routine's text, split outside backticks. */
function sentences(text) {
  const out = [];
  let cur = '';
  let tick = false;
  const s = oneLine(text);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    cur += c;
    if (c === '`') tick = !tick;
    else if (!tick && /[.;!?]/.test(c) && (i + 1 === s.length || s[i + 1] === ' ')) { out.push(cur.trim()); cur = ''; }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/* a step's run is typed into one shell, so it prints as one fence, PowerShell when any line is;
   coverage reads the run back in one piece */
const fence = (cmds) => ['```' + (cmds.some((c) => fenceOf(c) === 'powershell') ? 'powershell' : 'sh'), ...cmds, '```'];
/* a precondition as the README writes one: its text, and a check that proves it */
const precondition = (p) => {
  const t = oneLine(typeof p === 'string' ? p : p && (p.text || p.title));
  const c = p && typeof p === 'object' ? oneLine(p.check || p.run || '') : '';
  const text = t ? t.replace(/[.;:]*$/, '.') : c ? 'The condition holds.' : '';
  return !c ? text : c.includes('`') ? text + ' Check it with ' + c : text + ' check: `' + c + '`';
};

/* every step the routine gives is kept, one with no command as a prose step */
function stepsOf(row, lead) {
  const f = row.fields || {};
  const source = String(f.sourceText || row.excerpt || '');
  const steps = Array.isArray(f.steps) && f.steps.length ? f.steps.map((x) => ({ s: asWritten(x.said), cmds: x.cmds || [] })).filter((x) => x.s)
    : sentences(source).filter((s) => !/^expect/i.test(s)).map((s) => ({ s, cmds: [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()).filter(isCommand) }));
  if (!steps.some((x) => x.cmds.length) && (f.commands || []).length) steps.push({ s: lead + '.', cmds: f.commands });
  return steps;
}

/* the numbers of a card item's steps whose heading would stop at a comma: a long first clause cut mid-sentence */
export function commaHeads(item) {
  const row = cardRow(item, '');
  return stepsOf(row, oneLine(row.fields.lead || row.title)).map((x, i) => (/,$/.test(oneLine(headOf(x.s).head)) ? i + 1 : 0)).filter(Boolean);
}

export function cardText(row) {
  const f = row.fields || {};
  const name = String(f.target || '').replace(/^.*\//, '').replace(/\.md$/, '') || 'routine';
  const lead = oneLine(f.lead || row.title || name);
  const title = lead.replace(/[.;:]+$/, '');
  const steps = stepsOf(row, lead);
  /* Verify runs only the check the session named: rerunning a release card's last step would publish again */
  const last = f.check ? oneLine(f.check) : '';
  const scripts = [...new Set([...(f.scripts || []).map((x) => x.script), ...steps.flatMap((x) => x.cmds.flatMap((c) => commandScripts(c).map((y) => y.script)))])]
    .filter((s) => !isProgram(s));
  /* the README lints every backticked repo path in Steps and Verify against References */
  const paths = [...new Set([...scripts, ...steps.flatMap((x) => ticks(x.s).flatMap((t) => (!isCommand(t) ? (pathy(t) ? [t] : [])
    : x.cmds.includes(t) ? [] : commandScripts(t).map((y) => y.script))))])].filter((p) => !isProgram(p));
  const expect = f.expect ? oneLine(f.expect).replace(/^expect(s|ing)?\s+(that\s+)?/i, '') : '';
  /* a scoped rule's card keeps its scope as the card's file and command triggers */
  const tr = f.triggers || {};
  const trigCmds = [...new Set([...scripts, ...(tr.commands || []).map(oneLine).filter((c) => c && !isProgram(c))])];
  const trigFiles = [...new Set((tr.files || []).map(oneLine).filter(Boolean))];
  /* the item's own summary and words when it gives them, the title phrase among the words */
  const words = [...new Set([plain(lead), ...(f.words || []).map(plain)].map((w) => w.toLowerCase().replace(/[.;:!?]+$/, '')).filter(Boolean))];
  const pre = (Array.isArray(f.preconditions) ? f.preconditions : f.preconditions ? [f.preconditions] : []).map(precondition).filter(Boolean);
  const out = [
    '---', 'name: ' + name, 'title: ' + yaml(title), 'summary: ' + yaml(clip(f.summary || lead, 200)),
    'triggers:', '  words: ' + yamlList(words),
    ...(trigCmds.length ? ['  commands: ' + yamlList(trigCmds)] : []), ...(trigFiles.length ? ['  files: ' + yamlList(trigFiles)] : []), 'repos: {}', '---', '',
    '# ' + title, '', '## Trigger', '', lead.replace(/[.;:]*$/, '.'), '', '## Preconditions', '', ...(pre.length ? pre : ['None.']).map((p) => '- ' + p), '', '## Steps', '',
  ];
  steps.forEach((x, i) => {
    const { head, rest } = headOf(x.s);
    const h = oneLine(head) || 'Step ' + (i + 1);
    out.push('### ' + (i + 1) + '. ' + h.charAt(0).toUpperCase() + h.slice(1), '', ...(head ? (rest.trim() ? [...stepBody(rest), ''] : []) : [...stepBody(x.s), '']),
      ...(x.cmds.length ? [...fence(x.cmds), ''] : []));
  });
  out.push('## Verify', '', last ? (expect ? 'Run the check and read its result.' : 'The source states no result: run the check and see that it exits 0.')
    : 'The routine names no check, and rerunning a step may write again: read the last step\'s own output.', '',
    ...fence([last || '# no rerun: read the last step\'s output']), '', '- expect: ' + (expect || (last ? 'it exits 0.' : 'the last step reported success.')), '', '## References', '');
  if (paths.length) for (const p of paths) out.push('- `' + p + '`: ' + (scripts.includes(p) ? 'the script the steps run.' : 'named in the steps.'));
  else out.push('- `docs/procedures/' + name + '.md`: this card; its commands are on PATH.');
  return { name, text: out.join('\n') + '\n' };
}

export function writeCard(dir, row) {
  const { name, text } = cardText(row);
  const at = join(dir, 'docs', 'procedures');
  mkdirSync(at, { recursive: true });
  writeFileSync(join(at, name + '.md'), text);
  return { name, path: 'docs/procedures/' + name + '.md' };
}

/* a proposal's card item as the row cardText reads: its steps as sentences, each command backticked,
   and its verify as the result to expect. */
export function cardRow(item, target) {
  const f = item.fields || {};
  const cmd = (s) => (s && typeof s === 'object' ? s.run || s.command || s.cmd : null);
  /* the text as written; a one-line text that ends without punctuation takes its command after ": ", a tool it names by name */
  const said = (s) => {
    if (typeof s === 'string') return asWritten(s);
    if (!s || typeof s !== 'object') return '';
    const t = asWritten(s.text || s.title || '');
    const c = cmd(s) ? asWritten(cmd(s)) : '';
    if (!c || (t && /\n/.test(c))) return t;
    if (!t) return /\n/.test(c) ? 'Run:' : '`' + c + '`';
    if (!/\n/.test(t) && !ENDED.test(t)) return t + ': `' + c + '`';
    return TOOL.test(c) && !t.includes(c) ? t + (/\n/.test(t) ? '\n\n' : ' ') + 'Call `' + c + '`.' : t;
  };
  /* each step as given, its commands the lines it runs, a tool call in its text; an object step's command is its run
     only (its text may name a command it never runs), a string step's are its backticked commands */
  const given = (f.steps || []).map((s) => ({ said: said(s), run: cmd(s) ? asWritten(cmd(s)) : '', text: typeof s === 'string' })).filter((s) => s.said)
    .map((s) => ({ said: /\n/.test(s.said) || ENDED.test(s.said) ? s.said : s.said + '.',
      cmds: s.run ? (TOOL.test(s.run) ? [] : s.run.split('\n').map((l) => l.trim()).filter(Boolean)) : s.text ? ticks(s.said).filter(isCommand) : [] }));
  const steps = given.map((s) => s.said);
  const v = f.verify;
  const many = (x) => (Array.isArray(x) ? x : x ? [x] : []).map(String);
  return { title: item.title, excerpt: item.text, fields: { target, lead: item.title, summary: f.summary, words: many(f.words), preconditions: f.preconditions, sourceText: steps.length ? steps.join(' ') : String(item.text || ''), ...(given.length ? { steps: given } : {}),
    expect: typeof v === 'string' ? v : v ? v.expect || v.text || '' : '', ...(cmd(v) ? { check: cmd(v) } : {}), commands: f.commands, triggers: { files: many(f.files), commands: many(f.commands) } } };
}
