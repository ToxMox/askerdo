/* A repo's name as every machine reads it, with no host access, so the
   mod and the CLI share it (lib/project-id.mjs re-exports both). */
export function normDir(d) {
  return String(d || '').replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
}

/* host/owner/repo, lowercased, no credentials, port or .git; '' for a local path remote. */
export function normRemote(url) {
  const s = String(url || '').trim().replace(/^"|"$/g, '');
  if (!s || /^file:/i.test(s)) return '';
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:]+)(?::\d*)?\/(.+)$/i.exec(s)
    || /^(?:[^@/\s]+@)?([^/:\\\s]+):(?![\\/])(.+)$/.exec(s);
  /* a one-letter host is a drive letter */
  if (!m || m[1].length < 2) return '';
  const path = m[2].replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
  return path ? (m[1] + '/' + path).toLowerCase() : '';
}

