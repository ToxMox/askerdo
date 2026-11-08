/* Codex reads AGENTS.override.md in place of a folder's AGENTS.md and Claude Code never
   reads it, so where a project keeps an AGENTS.md this git-ignored file carries that text and the
   board's rules for agents. The SessionStart sync keeps it; the conversion's handover calls it too. */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gitOf } from './project-id.mjs';
import { writeAtomic } from './store-io.mjs';

export const OVERRIDE = 'AGENTS.override.md';
/* the file is AskerDo's to rewrite only while it carries this line */
export const OVERRIDE_MARK = '<!-- AskerDo: written from the board; rewritten whole when it changes -->';
/* Codex's default cap on the instruction files it reads */
export const OVERRIDE_MAX = 32 * 1024;

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
const bytes = (s) => Buffer.byteLength(s, 'utf8');
const level = (l) => { const m = /^(#{1,6})\s/.exec(l); return m ? m[1].length : 0; };

/* AGENTS.md's own AskerDo section is the handover's pointer for Claude, so it stays out */
function withoutAskerDo(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const s = lines.findIndex((l) => /^##\s+AskerDo\s*$/.test(l));
  if (s >= 0) {
    let e = s + 1;
    while (e < lines.length && !(level(lines[e]) && level(lines[e]) <= 2)) e++;
    lines.splice(s, e - s);
  }
  return lines.join('\n').replace(/\s+$/, '');
}

/* a rule's pointer at its detail record, which Codex cannot open */
const DETAIL = / ?[(]detail: [A-Z]+-[0-9]+[)]/g;
const flat = (s) => String(s || '').replace(/\s*\n\s*/g, ' ').trim();
const ticked = (xs) => xs.map((x) => '`' + x + '`');
const either = (xs) => (xs.length > 1 ? xs.slice(0, -1).join(', ') + ' or ' + xs[xs.length - 1] : xs[0]);
/* a decision as Codex can follow it: the files or commands it governs, then the ruling */
export function decisionLine(d) {
  const files = (d.files || []).map(String);
  const commands = (d.commands || []).map(String);
  const when = [files.length ? 'editing ' + either(ticked(files)) : '', commands.length ? 'running ' + either(ticked(commands)) : ''].filter(Boolean).join(', or ');
  return (when ? 'When ' + when + ': ' : '') + flat(d.name || d.title).replace(/([^.!?])$/, '$1.');
}

/* AGENTS.md's text, then the rules and the decisions on the project's files and commands; over the cap the text
   stays whole and the last lines go, counted. */
export function overrideText(agents, rows, decisions = []) {
  const head = withoutAskerDo(agents);
  const top = (head ? head + '\n\n' : '') + '## Rules in force (AskerDo board)\n\n' + OVERRIDE_MARK + '\n\n'
    + 'AskerDo writes this file from AGENTS.md and the board\'s rules and decisions for this project\'s agents: '
    + 'change AGENTS.md, or the board, never this file.\n\n';
  const lines = (rows || []).map((r) => '- ' + flat(String(r && typeof r === 'object' ? r.text : r).replace(DETAIL, '')))
    .concat((decisions || []).map((d) => '- ' + decisionLine(d)));
  const cut = (n) => (n < lines.length
    ? '\n' + (lines.length - n) + ' more rule' + (lines.length - n === 1 ? ' or decision is' : 's or decisions are') + ' on the board, left out to keep this file within Codex\'s 32 KiB limit.\n' : '');
  const text = (n) => top + lines.slice(0, n).map((l) => l + '\n').join('') + cut(n);
  let n = lines.length;
  while (n > 0 && bytes(text(n)) > OVERRIDE_MAX) n--;
  return { text: text(n), left: lines.length - n };
}

/* Where the file goes, or why none does: outside git, no AGENTS.md, or one AskerDo did not write. */
function target(dir) {
  const g = dir ? gitOf(String(dir)) : null;
  if (!g) return { did: 'none', why: 'not in a git checkout' };
  const agents = read(join(g.top, 'AGENTS.md'));
  if (agents === null) return { did: 'none', why: 'no AGENTS.md' };
  const path = join(g.top, OVERRIDE);
  const current = read(path);
  if (current !== null && !current.includes(OVERRIDE_MARK)) return { did: 'left', path, why: 'AskerDo did not write it' };
  return { top: g.top, common: g.common, agents, path, current };
}

/* The repo's own exclude, never a committed .gitignore; true when the line was added. */
function exclude(common) {
  const file = join(common, 'info', 'exclude');
  const now = read(file) || '';
  if (now.split(/\r?\n/).some((l) => l.trim() === OVERRIDE || l.trim() === '/' + OVERRIDE)) return false;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, (now && !now.endsWith('\n') ? '\n' : '') + '# AskerDo writes this file for Codex\n/' + OVERRIDE + '\n');
  return true;
}

/* rows: the rule rows for agents ({ text } or strings); decisions: { name, files, commands }. Answers { did: none |
   left | same | wrote, path, why, left (lines cut), excluded, created }; the ignore lands before the file. */
export function writeAgentsOverride(dir, rows, decisions = [], agents = null) {
  const t = target(dir);
  if (t.did) return t;
  /* agents: the AGENTS.md text to build from in place of the file's (an undo's, before its reverts run) */
  const { text, left } = overrideText(agents ?? t.agents, rows, decisions);
  const excluded = exclude(t.common);
  if (t.current === text) return { did: 'same', path: t.path, excluded };
  writeAtomic(t.path, text);
  return { did: 'wrote', path: t.path, left, excluded, created: t.current === null };
}

/* The rules as the mod resolves them for the project's agents (its rules script), then the write. */
export async function refreshAgentsOverride(dir, { env = process.env, agents = null } = {}) {
  const t = target(dir);
  if (t.did) return t;
  const { runScript } = await import('./mod-scripts.mjs');
  const r = await runScript({ argv: ['rules', '--cwd', t.top, '--json'], env });
  if (r.code) throw new Error(String(r.stderr).trim() || 'the rules read failed');
  const rows = (JSON.parse(r.stdout).rows || []).filter((x) => x.for !== 'session');
  /* the decisions governing the project's files or commands, as the mod's watcher reads them */
  const [{ boardCall }, { sharedName }] = await Promise.all([import('./board-call.mjs'), import('./project-id.mjs')]);
  const decisions = (await boardCall('decisionTriggers', { project: sharedName(t.top) }, { env })).filter((d) => d.type === 'decision');
  return writeAgentsOverride(t.top, rows, decisions, agents);
}
