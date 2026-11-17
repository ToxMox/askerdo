/* Codex reads AGENTS.override.md in place of a folder's AGENTS.md and Claude Code never
   reads it, so where a project keeps an AGENTS.md this git-ignored file carries that text and the
   board's rules for agents. The SessionStart sync keeps it; the conversion's handover calls it too. */
import { appendFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileLink } from './decision-match.mjs';
import { gitOf } from './project-id.mjs';
import { writeAtomic } from './store-io.mjs';

export const OVERRIDE = 'AGENTS.override.md';
/* what the cap leaves out, which Codex reads only when the override sends it there */
export const REST = 'AGENTS.override.rest.md';
/* the file is AskerDo's to rewrite only while it carries this line */
export const OVERRIDE_MARK = '<!-- AskerDo: written from the board; rewritten whole when it changes -->';
/* Codex's default project_doc_max_bytes, the cap on all the instruction files it reads together */
export const OVERRIDE_MAX = 32 * 1024;

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
const bytes = (s) => Buffer.byteLength(s, 'utf8');
const level = (l) => { const m = /^(#{1,6})\s/.exec(l); return m ? m[1].length : 0; };

/* Codex's byte budget for the project's instruction files: project_doc_max_bytes from the project's .codex/config.toml,
   else Codex home's. Its global AGENTS.md sits outside that budget, and a file past it is cut at the byte. */
export function codexBudget(env = process.env, top = '') {
  const home = env.CODEX_HOME || join(env.HOME || env.USERPROFILE || homedir(), '.codex');
  const setting = (file) => {
    const lines = String(read(file) || '').split(/\r?\n/);
    const end = lines.findIndex((l) => /^\s*\[/.test(l));
    const m = (end < 0 ? lines : lines.slice(0, end)).map((l) => /^\s*project_doc_max_bytes\s*=\s*(\d+)/.exec(l)).find(Boolean);
    return m ? Number(m[1]) : null;
  };
  return (top ? setting(join(top, '.codex', 'config.toml')) : null) ?? setting(join(home, 'config.toml')) ?? OVERRIDE_MAX;
}

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
const stop = (s) => s.replace(/([^.!?])$/, '$1.');
/* a decision as Codex can follow it: the files or commands it governs, then the ruling */
export function decisionLine(d) {
  const links = (d.files || []).map(fileLink);
  /* a glob marked (read) or (search) is named under that verb */
  const on = (o) => links.filter((l) => l.on.includes(o) && l.glob).map((l) => l.glob + (l.contains ? ' | ' + l.contains : ''));
  const commands = (d.commands || []).map(String);
  const when = [['editing', on('edit')], ['reading', on('read')], ['searching', on('search')], ['running', commands]]
    .filter(([, xs]) => xs.length).map(([verb, xs]) => verb + ' ' + either(ticked(xs))).join(', or ');
  return (when ? 'When ' + when + ': ' : '') + stop(flat(d.name || d.title));
}

const slashed = (p) => String(p || '').replace(/\\/g, '/');
/* a procedure card as Codex can follow it, as the mod's pointer tells Claude: what sets it off,
   then the file holding its steps (repo-relative when it is this repo's) */
export function cardLine(c, top = '') {
  const path = slashed(c.path || c.doc);
  const base = slashed(top).replace(/\/+$/, '');
  const rel = base && path.toLowerCase().startsWith(base.toLowerCase() + '/') ? path.slice(base.length + 1) : path;
  const files = (c.files || []).map(String);
  const commands = (c.commands || []).map(String);
  /* the title already names the work, so a phrase repeating it goes; four phrases say what else does */
  const named = flat(c.name).toLowerCase().replace(/[.!?]$/, '');
  const words = (c.words || []).map((w) => flat(w)).filter((w) => w && !named.includes(w.toLowerCase())).slice(0, 4).map((w) => '"' + w + '"');
  const when = [commands.length ? 'running ' + either(ticked(commands)) : '', files.length ? 'editing ' + either(ticked(files)) : '',
    words.length ? 'the work is ' + either(words) : ''].filter(Boolean).join(', or ');
  const state = c.badge === 'stale' || c.badge === 'flagged'
    ? ' The card is ' + c.badge + ' (' + flat((c.reasons || [])[0] || '').slice(0, 120) + '), so check each step against the code as you go.' : '';
  return 'Procedure ' + c.id + ', ' + flat(c.name).replace(/[.!?]$/, '') + ': ' + (when ? 'when ' + when + ', ' : '')
    + 'read `' + rel + '` and follow its steps.' + state;
}

const counted = (n, one, many) => n + ' ' + (n === 1 ? one : many);
/* the left-out lines by kind, in words */
function leftWords(kinds) {
  const k = { rule: 0, card: 0, decision: 0 };
  for (const x of kinds) k[x]++;
  return [k.rule && counted(k.rule, 'rule', 'rules'), k.card && counted(k.card, 'procedure', 'procedures'), k.decision && counted(k.decision, 'decision', 'decisions')]
    .filter(Boolean).join(', ');
}

/* AGENTS.md's text, then the rules, the procedure cards and the decisions on the project's files and commands.
   Over Codex's budget the text stays whole and the last lines move to the rest file, which the override names. */
export function overrideText(agents, rows, decisions = [], { cards = [], top = '', max = OVERRIDE_MAX } = {}) {
  const head = withoutAskerDo(agents);
  const lead = (head ? head + '\n\n' : '') + '## Rules in force (AskerDo board)\n\n' + OVERRIDE_MARK + '\n\n'
    + 'AskerDo writes this file from AGENTS.md and the board\'s rules, procedures and decisions for this project\'s agents: '
    + 'change AGENTS.md, the board or the procedure files, never this file.\n\n';
  const items = (rows || []).map((r) => ({ kind: 'rule', line: '- ' + flat(String(r && typeof r === 'object' ? r.text : r).replace(DETAIL, '')) }))
    .concat((cards || []).map((c) => ({ kind: 'card', line: '- ' + cardLine(c, top) })))
    .concat((decisions || []).map((d) => ({ kind: 'decision', line: '- ' + decisionLine(d) })));
  /* first in the file, so Codex's byte cut keeps it even when AGENTS.md's text alone fills the budget */
  const cut = (n) => (n < items.length
    ? 'Left out of this file to keep what Codex reads within its size limit: ' + leftWords(items.slice(n).map((x) => x.kind))
      + ', all in `' + REST + '` beside it. Read that file before you edit files or run commands.\n\n' : '');
  const text = (n) => cut(n) + lead + items.slice(0, n).map((x) => x.line + '\n').join('');
  let n = items.length;
  while (n > 0 && bytes(text(n)) > max) n--;
  const rest = n < items.length
    ? '# Rules in force, continued (AskerDo board)\n\n' + OVERRIDE_MARK + '\n\nThe rules, procedures and decisions `' + OVERRIDE
      + '` had no room for under Codex\'s size limit; they bind as the ones there do.\n\n' + items.slice(n).map((x) => x.line + '\n').join('')
    : null;
  return { text: text(n), left: items.length - n, rest, leftBy: leftWords(items.slice(n).map((x) => x.kind)) };
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

/* The repo's own exclude, never a committed .gitignore; true when a line was added. */
function exclude(common, name) {
  const file = join(common, 'info', 'exclude');
  const now = read(file) || '';
  if (now.split(/\r?\n/).some((l) => l.trim() === name || l.trim() === '/' + name)) return false;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, (now && !now.endsWith('\n') ? '\n' : '') + '# AskerDo writes this file for Codex\n/' + name + '\n');
  return true;
}

/* rows: the rule rows for agents ({ text } or strings); decisions: { name, files, commands }; cards: the procedure
   cards at this checkout. Answers { did: none | left | same | wrote, path, why, left (lines moved to the rest file),
   rest (its path), excluded, created }; the ignore lands before the file. */
export function writeAgentsOverride(dir, rows, decisions = [], agents = null, { cards = [], env = process.env } = {}) {
  const t = target(dir);
  if (t.did) return t;
  /* agents: the AGENTS.md text to build from in place of the file's (an undo's, before its reverts run) */
  const o = overrideText(agents ?? t.agents, rows, decisions, { cards, top: t.top, max: codexBudget(env, t.top) });
  const excluded = exclude(t.common, OVERRIDE);
  const restPath = join(t.top, REST);
  const restNow = read(restPath);
  /* a rest file someone else wrote is never overwritten; with nothing left out ours goes */
  if (o.rest !== null && (restNow === null || restNow.includes(OVERRIDE_MARK))) {
    exclude(t.common, REST);
    if (restNow !== o.rest) writeAtomic(restPath, o.rest);
  } else if (o.rest === null && restNow !== null && restNow.includes(OVERRIDE_MARK)) rmSync(restPath, { force: true });
  const extra = o.left ? { rest: restPath, leftBy: o.leftBy } : {};
  if (t.current === o.text) return { did: 'same', path: t.path, left: o.left, excluded, ...extra };
  writeAtomic(t.path, o.text);
  return { did: 'wrote', path: t.path, left: o.left, excluded, created: t.current === null, ...extra };
}

/* the board's live procedure cards that bind this checkout, at its paths: the project's own, another
   repo's whose steps touch this one, and the plugin's cards for every project. */
async function cardsFor(top, env) {
  const [{ boardCall }, { cardsHere }, { coveredRepos, relativeTo }] = await Promise.all([
    import('./board-call.mjs'), import('./procedures.mjs'), import('./proc-match.mjs')]);
  const all = await boardCall('triggerCards', {}, { env });
  const here = await cardsHere(Array.isArray(all) ? all : [], top);
  return here.filter((c) => c && c.status !== 'retired' && c.path
    && (c.everywhere || coveredRepos(c).some((r) => relativeTo(r.root, top) !== null)))
    .sort((a, b) => (a.everywhere ? 1 : 0) - (b.everywhere ? 1 : 0) || Number(String(a.id).slice(3)) - Number(String(b.id).slice(3)));
}

/* The rules as the mod resolves them for the project's agents (its rules script), then the write. */
export async function refreshAgentsOverride(dir, { env = process.env, agents = null } = {}) {
  const t = target(dir);
  if (t.did) return t;
  const { runScript } = await import('./mod-scripts.mjs');
  const r = await runScript({ argv: ['rules', '--cwd', t.top, '--json'], env });
  if (r.code) throw new Error(String(r.stderr).trim() || 'the rules read failed');
  /* a role's line binds one kind of Claude agent, which Codex never is */
  const rows = (JSON.parse(r.stdout).rows || []).filter((x) => x.for !== 'session' && !x.role);
  /* the decisions governing the project's files or commands, as the mod's watcher reads them */
  const [{ boardCall }, { sharedName }] = await Promise.all([import('./board-call.mjs'), import('./project-id.mjs')]);
  const decisions = (await boardCall('decisionTriggers', { project: sharedName(t.top) }, { env })).filter((d) => d.type === 'decision');
  const cards = await cardsFor(t.top, env);
  return writeAgentsOverride(t.top, rows, decisions, agents, { cards, env });
}
