/* The rules block's text, pure: the board's renderer (verbs/profile-rules.mjs) and the
   mod's dispatch (lib/mod-core.mjs) both build it here, so a role's block reads the same. */

/* what the mod looks for, so one revision's block is appended once */
export const RULES_HEAD = 'Rules in force (AskerDo rev ';

/* a role is one word, as a subagent type or a task label reads lowercased */
export const ROLE_RE = /^[a-z0-9][a-z0-9:_-]{0,39}$/;

function revisionOf(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

export function blockOf(record, rows, who) {
  const body = rows.map((r) => '- ' + r.text + ' [' + r.source + ']');
  const revision = revisionOf(body.join('\n'));
  return { revision, text: [RULES_HEAD + revision + ', for ' + record + (who ? ', ' + who : '') + '):', ...body].join('\n') };
}

/* The roles a dispatch plays: its subagent type and the labels of the tasks it serves. */
export function dispatchRoles(type, labels = []) {
  return [...new Set([type, ...(labels || [])].map((x) => String(x || '').trim().toLowerCase()).filter((x) => ROLE_RE.test(x)))];
}

/* The agents' block for a dispatch playing these roles: every agents line, and each line
   bound to one of its roles. No role line matching, it is the plain agents block. */
export function agentsBlockFor(b, roles = []) {
  if (!b || !Array.isArray(b.rows)) return b && b.agents ? b.agents : null;
  const mine = new Set(roles);
  const hit = b.rows.filter((r) => r.role && mine.has(r.role));
  if (!hit.length) return b.agents || null;
  const rows = b.rows.filter((r) => r.for !== 'session' && (!r.role || mine.has(r.role)));
  return blockOf(b.record, rows, 'its ' + [...new Set(hit.map((r) => r.role))].join(' and ') + ' agents');
}
