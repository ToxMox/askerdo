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
const RUNNER = /^(npm|npx|node|git|python3?|pip|cargo|go|make|dotnet|bash|sh|pwsh|powershell|yarn|pnpm|uv|docker|claude)\b/;
const isCommand = (s) => RUNNER.test(s.trim()) || (commandScripts(s).length > 0 && (/\s/.test(s.trim()) || /\.(m?js|cjs|ts|ps1|sh|py|cmd|bat|exe)$/i.test(s.trim())));
const fenceOf = (cmd) => (/\.ps1\b|^[A-Z][a-z]+-[A-Z][A-Za-z]+\b|^(pwsh|powershell)\b/.test(cmd) ? 'powershell' : 'sh');
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

const fence = (cmds) => ['```' + fenceOf(cmds[0]), ...cmds, '```'];

export function cardText(row) {
  const f = row.fields || {};
  const name = String(f.target || '').replace(/^.*\//, '').replace(/\.md$/, '') || 'routine';
  const lead = oneLine(f.lead || row.title || name);
  const title = lead.replace(/[.;:]+$/, '');
  const source = String(f.sourceText || row.excerpt || '');
  /* every step the routine gives is kept, one with no command as a prose step */
  const steps = Array.isArray(f.steps) && f.steps.length ? f.steps.map((x) => ({ s: oneLine(x.said), cmds: x.cmds || [] })).filter((x) => x.s)
    : sentences(source).filter((s) => !/^expect/i.test(s)).map((s) => ({ s, cmds: [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()).filter(isCommand) }));
  if (!steps.some((x) => x.cmds.length) && (f.commands || []).length) steps.push({ s: lead + '.', cmds: f.commands });
  /* Verify runs only the check the session named: rerunning a release card's last step would publish again */
  const last = f.check ? oneLine(f.check) : '';
  const scripts = [...new Set([...(f.scripts || []).map((x) => x.script), ...steps.flatMap((x) => x.cmds.flatMap((c) => commandScripts(c).map((y) => y.script)))])];
  /* the README lints every backticked repo path in Steps and Verify against References */
  const paths = [...new Set([...scripts, ...steps.flatMap((x) => [...x.s.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()).filter((t) => !isCommand(t) && pathy(t)))])];
  const expect = f.expect ? oneLine(f.expect).replace(/^expect(s|ing)?\s+(that\s+)?/i, '') : '';
  /* a scoped rule's card keeps its scope as the card's file and command triggers */
  const tr = f.triggers || {};
  const trigCmds = [...new Set([...scripts, ...(tr.commands || []).map(oneLine).filter(Boolean)])];
  const trigFiles = [...new Set((tr.files || []).map(oneLine).filter(Boolean))];
  const out = [
    '---', 'name: ' + name, 'title: ' + yaml(title), 'summary: ' + yaml(clip(lead, 200)),
    'triggers:', '  words: ' + yamlList([plain(lead).toLowerCase().replace(/[.;:!?]+$/, '')].filter(Boolean)),
    ...(trigCmds.length ? ['  commands: ' + yamlList(trigCmds)] : []), ...(trigFiles.length ? ['  files: ' + yamlList(trigFiles)] : []), 'repos: {}', '---', '',
    '# ' + title, '', '## Trigger', '', lead.replace(/[.;:]*$/, '.'), '', '## Preconditions', '', '- None.', '', '## Steps', '',
  ];
  steps.forEach((x, i) => {
    const tidy = (s) => oneLine(s).replace(/[\s,;:.!?-]+$/, '').replace(/\s+(with|using|via|by|run|from|in|at|on|and)$/i, '').replace(/[\s,;:.!?-]+$/, '');
    let head = tidy(plain(x.s.split(/`|:\s/)[0]));
    if (head.split(/\s+/).length < 2) head = tidy(x.s.replace(/`/g, ''));
    out.push('### ' + (i + 1) + '. ' + head.charAt(0).toUpperCase() + head.slice(1), '', x.s, '', ...(x.cmds.length ? [...fence(x.cmds), ''] : []));
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
  const said = (s) => (typeof s === 'string' ? s : s && typeof s === 'object' ? [s.text || s.title || '', cmd(s) ? '`' + cmd(s) + '`' : ''].filter(Boolean).join(': ') : '');
  /* each step as given, its command the one it runs (a string step's backticked commands) */
  const given = (f.steps || []).map((s) => ({ said: oneLine(said(s)), run: cmd(s) })).filter((s) => s.said)
    .map((s) => ({ said: /[.!?]$/.test(s.said) ? s.said : s.said + '.', cmds: s.run ? [oneLine(s.run)] : [...s.said.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()).filter(isCommand) }));
  const steps = given.map((s) => s.said);
  const v = f.verify;
  const many = (x) => (Array.isArray(x) ? x : x ? [x] : []).map(String);
  return { title: item.title, excerpt: item.text, fields: { target, lead: item.title, sourceText: steps.length ? steps.join(' ') : String(item.text || ''), ...(given.length ? { steps: given } : {}),
    expect: typeof v === 'string' ? v : v ? v.expect || v.text || '' : '', ...(cmd(v) ? { check: cmd(v) } : {}), commands: f.commands, triggers: { files: many(f.files), commands: many(f.commands) } } };
}
