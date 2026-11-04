/* The board server's wire constants, shared by the server and the
   PC side, so a route served and a link minted cannot drift. Plain data only:
   the PC imports this without loading the server. */

/* Bumped when a request or reply changes shape; each side compares its own copy. */
export const PROTOCOL = 1;
export const PROTOCOL_HEADER = 'x-askerdo-protocol';

/* the loopback admin route takes the per-start secret the board writes beside
   its database, so only an account that can read that folder calls it */
export const ADMIN_HEADER = 'x-askerdo-admin';
export const ADMIN_SECRET_FILE = 'admin-secret';

export const API = '/api/v1';
export const COOKIE = 'askerdo_web';

const seg = (s) => encodeURIComponent(String(s ?? '').trim());

/* The web pages the board serves: a record by label, the Needs you view, a workstream. */
export const WEB = Object.freeze({
  root: () => '/',
  record: (label) => '/r/' + seg(label),
  /* by the project's shared name (register's projectRepo); the page still reads an older link's project= */
  needsYou: (repo) => '/needs-you' + (repo ? '?repo=' + seg(repo) : ''),
  workstream: (label) => '/ws/' + seg(label),
  /* an override request's full before and after */
  override: (n) => '/override/' + seg(n),
  archive: (rel) => '/archive/' + String(rel || '').split('/').filter(Boolean).map(seg).join('/'),
});

/* "this PC speaks protocol 1, the board speaks 2: update the plugin" */
export function protocolMessage(mine, theirs) {
  const pc = Number(mine);
  const board = Number(theirs);
  if (!Number.isFinite(pc)) return 'this caller names no protocol version; the board speaks ' + board + ': update the plugin';
  return 'this PC speaks protocol ' + pc + ', the board speaks ' + board + ': update the '
    + (pc < board ? 'plugin' : 'board server');
}
