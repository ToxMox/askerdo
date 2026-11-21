/* The board server's wire constants, shared by the server and the
   PC side, so a route served and a link minted cannot drift. Plain data only:
   the PC imports this without loading the server. */

/* Bumped by a release that changes what a PC sends or what the board accepts: the board
   refuses a PC on another protocol (426), so nothing half works. */
export const PROTOCOL = 5;
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

/* A run is heard while its last renewal is inside this window (renewed each minute);
   here so a PC's local server knows when a kept running word turns */
export const HEARD_MS = 3 * 60000;

export const PLUGIN_UPDATE = 'claude plugin update askerdo@askerdo';

/* A PC (mine) and a board (theirs) on two protocols: which side updates, and how.
   `says` leads with the side, since a band row may show only its start. */
export function protocolWords(mine, theirs) {
  const pc = Number(mine);
  const board = Number(theirs);
  if (Number.isFinite(pc) && pc > board) {
    return { side: 'board', says: 'update the board server: it speaks protocol ' + board + ' and this PC ' + pc + ', so it refuses this PC',
      fix: "back it up, then rebuild it from the new release as Upgrade on the guide's Set up a board page says" };
  }
  const says = Number.isFinite(pc) ? 'update AskerDo on this PC: the board speaks protocol ' + board + ' and this PC ' + pc + ', so the board refuses it'
    : 'update AskerDo on the caller: it names no protocol and the board speaks ' + board + ', so the board refuses it';
  return { side: 'pc', says, fix: 'run ' + PLUGIN_UPDATE + ', then start a new session', copy: PLUGIN_UPDATE };
}

/* The board's 426 words, which an older PC shows as they come */
export function protocolMessage(mine, theirs) {
  const w = protocolWords(mine, theirs);
  return w.says + '; ' + w.fix;
}
