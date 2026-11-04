/* The ONE list of what the board serves under /assets, and so of what a page
   may load. It lives in lib because both readers need it and the server's
   module body starts a server the moment it is imported. */

/* Prototype-free on purpose: a plain object answers ASSETS['__proto__'] with
   an inherited truthy value, which would walk a request name past the gate. */
export const ASSETS = Object.assign(Object.create(null), {
  'house.css': 'text/css; charset=utf-8',
  /* the file viewer's client stack, vendored and pinned by
     scripts/build-viewer.mjs, and loaded by the f/ viewer page alone. */
  'markdown-it.min.js': 'text/javascript; charset=utf-8',
  'purify.min.js': 'text/javascript; charset=utf-8',
  'highlight.min.js': 'text/javascript; charset=utf-8',
  /* three faces of one mark, swapped by href alone. The mark
     alone, no tile. */
  'favicon.svg': 'image/svg+xml; charset=utf-8',
  'favicon-quiet.svg': 'image/svg+xml; charset=utf-8',
  'favicon-blocking.svg': 'image/svg+xml; charset=utf-8',
  /* the same three faces as 32 px rasters. No page links them today: they are
     registered so a link is one href away rather than a route change, a served
     asset off this list being a 404 by design. */
  'favicon-32.png': 'image/png',
  'favicon-quiet-32.png': 'image/png',
  'favicon-blocking-32.png': 'image/png',
  /* the UI face the house sheet asks for by a relative url, so it resolves
     from the same directory on every served page */
  'geist.woff2': 'font/woff2',
});

/* The same register as a name set. */
export const ASSET_NAMES = new Set(Object.keys(ASSETS));
