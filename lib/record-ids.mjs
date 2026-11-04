/* Record keys. Pure. A key is identity and never
   changes; the board mints them (server/records.mjs mintKey), the PC only tells
   a key from a label. */

/* eight of lowercase Crockford base32 without i l o u: 40 bits per key */
export const KEY_RE = /^[0-9a-hjkmnp-tv-z]{8}$/;

export const isKey = (s) => typeof s === 'string' && KEY_RE.test(s);
