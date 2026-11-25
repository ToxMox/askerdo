/* A question's ask by its length, for the board's result and the mod's. Pure: the hooks module loads it. */

/* what an ask reads at a glance in; a longer one is stored as sent, its drawings wrap
   it, and the request body bounds it */
export const ASK_MAX = 400;

/* The note a longer ask's result carries: its length and the edit that shortens it; '' within the length. */
export function longAsk(id, ask) {
  const n = String(ask || '').length;
  if (n <= ASK_MAX) return '';
  const q = String(id);
  return q + "'s ask is " + n + ' characters (over ' + ASK_MAX + '), stored as sent. Shorten it with the ask tool and edits: "' + q + '"'
    + (/^L/i.test(q) ? '' : ' (or question edit ' + q + ', the question on stdin)') + ', the whole question reworded, never a new one';
}
