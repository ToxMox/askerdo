/* Which decisions a tool call touches: pure, so the mod's watcher and
   node --test match one way. A row is the shape `askerdo decisions triggers --json`
   prints: files are globs relative to `project` (this PC's checkout), commands are
   fragments in the procedure card's syntax. */
import { COMMAND_TOOLS, FILE_TOOLS, commandMatches, globRe, triggerWhy } from './proc-match.mjs';

const norm = (p) => String(p || '').trim().replace(/\\/g, '/').replace(/(.)\/+$/, '$1');
const caseless = (p) => (/^[A-Za-z]:\//.test(p) ? p.toLowerCase() : p);
const absolute = (p) => /^[A-Za-z]:\//.test(p) || p.startsWith('/');

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

/* [{ decision, why }]: a command while the call runs in the decision's checkout, or an
   edited path one of its globs takes (`<glob> | <contains>` wants the text too). */
export function decisionHits(rows, { tool, input, cwd } = {}) {
  const inp = input && typeof input === 'object' ? input : {};
  const hits = [];
  for (const d of Array.isArray(rows) ? rows : []) {
    if (!d || !d.id) continue;
    if (COMMAND_TOOLS.includes(tool)) {
      const cmd = String(inp.command || '');
      if (!cmd.trim() || (d.project && inside(d.project, cwd || '') === null)) continue;
      const frag = (d.commands || []).find((c) => c && commandMatches(cmd, String(c)));
      if (frag) hits.push({ decision: d, why: triggerWhy(frag) });
    } else if (FILE_TOOLS.includes(tool)) {
      let path = norm(inp.file_path || inp.notebook_path || '');
      if (!path || !d.project) continue;
      if (!absolute(path) && cwd) path = norm(cwd) + '/' + path;
      const rel = inside(d.project, path);
      if (!rel) continue;
      for (const f of d.files || []) {
        const s = String(f || '');
        const bar = s.indexOf(' | ');
        const glob = bar < 0 ? s : s.slice(0, bar);
        if (!glob || !globRe(glob).test(rel)) continue;
        if (bar >= 0 && !editText(tool, inp).includes(s.slice(bar + 3))) continue;
        hits.push({ decision: d, why: 'the edit of ' + rel + ' matches ' + s });
        break;
      }
    }
  }
  return hits;
}
