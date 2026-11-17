/* Which decisions a tool call touches: pure, so the mod's watcher and
   node --test match one way. A row is the shape `askerdo decisions triggers --json`
   prints: files are globs relative to `project` (this PC's checkout), commands are
   fragments in the procedure card's syntax. */
import { COMMAND_TOOLS, FILE_TOOLS, commandMatches, commandsOf, globRe, readsOnly, triggerWhy } from './proc-match.mjs';

/* a read or a search points only at a glob that opts in, since a session reads far more than it edits */
export const READ_TOOLS = ['Read'];
export const SEARCH_TOOLS = ['Grep', 'Glob'];
export const OCCASIONS = ['edit', 'read', 'search'];

const norm = (p) => String(p || '').trim().replace(/\\/g, '/').replace(/(.)\/+$/, '$1');
const caseless = (p) => (/^[A-Za-z]:\//.test(p) ? p.toLowerCase() : p);
const absolute = (p) => /^[A-Za-z]:\//.test(p) || p.startsWith('/');

/* A stored file link: `[(<occasions>)] <glob> [| <contains>]`; no marker means (edit). */
export function fileLink(s) {
  const raw = String(s || '').trim();
  const m = /^\(([^)]*)\)\s*(.*)$/.exec(raw);
  const on = m ? m[1].toLowerCase().split(/[\s,]+/).filter(Boolean) : ['edit'];
  const rest = m ? m[2] : raw;
  const bar = rest.indexOf(' | ');
  return { on, glob: bar < 0 ? rest : rest.slice(0, bar), contains: bar < 0 ? '' : rest.slice(bar + 3) };
}

/* The path inside `root`, or null when it lies outside. */
function inside(root, path) {
  const r = caseless(norm(root));
  const p = norm(path);
  if (!r) return null;
  if (caseless(p) === r) return '';
  return caseless(p).startsWith(r + '/') ? p.slice(r.length + 1) : null;
}

function editText(tool, input) {
  if (tool === 'Write') return String(input.content || '');
  if (tool === 'NotebookEdit') return String(input.new_source || '');
  if (tool === 'MultiEdit') return (Array.isArray(input.edits) ? input.edits : []).map((e) => String((e && e.new_string) || '')).join('\n');
  return String(input.new_string || '');
}

/* Whether a file the glob takes can lie at or under `rel` ('' is the whole repo). */
function couldHold(glob, rel) {
  if (!rel) return true;
  const gs = glob.split('/');
  const rs = rel.split('/');
  for (let i = 0; i < rs.length; i++) {
    if (i >= gs.length) return false;
    if (gs[i].includes('**')) return true;
    if (!globRe(gs[i]).test(rs[i])) return false;
  }
  return true;
}

/* The leading segments of a search glob with no wildcard: a Glob pattern is anchored at its
   path, a Grep glob only when it has a slash (else it takes a name at any depth). */
function literalLead(pattern, anchored) {
  const p = norm(pattern).replace(/^(\.\/)+/, '');
  if (!p || (!anchored && !p.includes('/'))) return '';
  const lead = [];
  for (const seg of p.split('/')) {
    if (/[*?[{]/.test(seg)) break;
    lead.push(seg);
  }
  return lead.join('/');
}

/* The folder or file a search covers, absolute: its path (else the cwd) narrowed by its glob's literal lead. */
function searchScope(tool, input, cwd) {
  let base = norm(input.path || '') || norm(cwd);
  if (base && !absolute(base) && cwd) base = norm(cwd) + '/' + base;
  const lead = tool === 'Glob' ? literalLead(input.pattern, true) : literalLead(input.glob, false);
  return base && lead ? base + '/' + lead : base;
}

/* [{ decision, why }]: a command while the call runs in the decision's checkout; an edited,
   read or searched path one of its globs takes on that occasion (`<glob> | <contains>` wants
   the edit's text or the search's pattern to hold it; a read is decided by the glob). */
export function decisionHits(rows, { tool, input, cwd } = {}) {
  const inp = input && typeof input === 'object' ? input : {};
  const hits = [];
  const occasion = FILE_TOOLS.includes(tool) ? 'edit' : READ_TOOLS.includes(tool) ? 'read' : SEARCH_TOOLS.includes(tool) ? 'search' : null;
  for (const d of Array.isArray(rows) ? rows : []) {
    if (!d || !d.id) continue;
    if (COMMAND_TOOLS.includes(tool)) {
      const cmd = String(inp.command || '');
      if (!cmd.trim() || (d.project && inside(d.project, cwd || '') === null)) continue;
      const frag = (d.commands || []).find((c) => c && commandMatches(cmd, String(c)));
      if (frag) hits.push({ decision: d, why: triggerWhy(frag) });
    } else if (occasion) {
      if (!d.project) continue;
      let path = occasion === 'search' ? searchScope(tool, inp, cwd) : norm(inp.file_path || inp.notebook_path || '');
      if (!path) continue;
      if (!absolute(path) && cwd) path = norm(cwd) + '/' + path;
      const rel = inside(d.project, path);
      if (rel === null || (!rel && occasion !== 'search')) continue;
      for (const f of d.files || []) {
        const l = fileLink(f);
        if (!l.glob || !l.on.includes(occasion)) continue;
        if (occasion === 'search') {
          if (!couldHold(l.glob, rel)) continue;
          if (l.contains && !String(inp.pattern || '').toLowerCase().includes(l.contains.toLowerCase())) continue;
        } else {
          if (!globRe(l.glob).test(rel)) continue;
          /* any case, as a search's word: a ruling on "Opus" bears on "agent:opus" too */
          if (l.contains && occasion === 'edit' && !editText(tool, inp).toLowerCase().includes(l.contains.toLowerCase())) continue;
        }
        hits.push({ decision: d, why: 'the ' + occasion + ' of ' + (rel || 'the repo') + ' matches ' + String(f) });
        break;
      }
    }
  }
  return hits;
}

/* how a pointer and its toast name the call: the file inside the cwd, or the
   command's first program and words */
export function callSubject(tool, input, cwd) {
  const inp = input && typeof input === 'object' ? input : {};
  if (COMMAND_TOOLS.includes(tool)) {
    const words = commandsOf(inp.command, { keepCase: true }).cmds.find((w) => w.length && !MOVES.includes(String(w[0]).toLowerCase())) || [];
    const cut = [];
    for (const w of words) { if (cut.length === 4 || w.length > 60 || /\s/.test(w)) break; cut.push(w); }
    return cut.join(' ') || 'this command';
  }
  const occasion = FILE_TOOLS.includes(tool) ? 'edit' : READ_TOOLS.includes(tool) ? 'read' : SEARCH_TOOLS.includes(tool) ? 'search' : '';
  /* a search is named by the folder it covers, as decisionHits reads it: a Grep pattern is a regex, not a path */
  let p = occasion === 'search' ? searchScope(tool, inp, cwd) : norm(inp.file_path || inp.notebook_path || '');
  if (p && !absolute(p) && cwd) p = norm(cwd) + '/' + p;
  const rel = p ? inside(cwd || '', p) : null;
  const name = rel || (rel === '' ? 'the repo' : p.split('/').pop());
  return occasion && name ? 'the ' + occasion + ' of ' + name : 'this call';
}

/* What a turn ran, proposed as a ruling's commands when it names no links: each command that
   runs something, cut to its program and first words; the AskerDo CLI's own calls, reads, folder
   moves and git bookkeeping are left out. Edited files are never proposed: a shared file
   drew every ruling recorded beside it. */
const LINKS_MAX = 10;
const HUB = /askerdo[\\/]cli\.mjs|bin[\\/]askerdo\.mjs/;
const MOVES = ['cd', 'set-location', 'sl', 'pushd', 'popd'];
/* the session's own version control bookkeeping, which every turn that commits runs; a forced
   or hard one stays, since a ruling is plausibly about it */
const GIT_BOOKKEEPING = ['add', 'commit', 'push', 'pull', 'fetch', 'stash', 'checkout', 'switch', 'restore', 'merge'];
function gitBookkeeping(words) {
  if (words[0] !== 'git') return false;
  let i = 1;
  while (i < words.length && words[i].startsWith('-')) i += /^-[Cc]$/.test(words[i]) ? 2 : 1;
  if (!GIT_BOOKKEEPING.includes(words[i])) return false;
  const rest = words.slice(i + 1);
  if (rest.some((w) => /^--force|^--hard$|^-f$/.test(w))) return false;
  /* a push that deletes a branch or forces one refspec is as plausible a ruling */
  return !(words[i] === 'push' && rest.some((w) => /^(-d|--delete)$|^[:+]./.test(w)));
}
export function turnCommands(calls) {
  const commands = [];
  for (const c of Array.isArray(calls) ? calls : []) {
    const inp = c && c.input && typeof c.input === 'object' ? c.input : {};
    if (!COMMAND_TOOLS.includes(c && c.tool) || HUB.test(String(inp.command || ''))) continue;
    const kept = commandsOf(inp.command, { keepCase: true }).cmds;
    commandsOf(inp.command).cmds.forEach((words, i) => {
      const at = words.findIndex((w) => !/^[a-z_][a-z0-9_]*=/.test(w));
      if (at < 0 || readsOnly(words) || MOVES.includes(words[at]) || words[at].startsWith('$') || gitBookkeeping(words.slice(at))) return;
      const cut = [];
      for (const w of kept[i].slice(at)) { if (cut.length === 4 || w.length > 60 || /\s/.test(w)) break; cut.push(w); }
      const f = cut.join(' ');
      if (f && !commands.includes(f)) commands.push(f);
    });
  }
  return commands.slice(0, LINKS_MAX);
}
