#!/usr/bin/env node
/* Prints the personal alias for /askerdo from the saved options, for
 * the mod, which cannot resolve the data directory itself.
 *
 *   node scripts/mod-alias.mjs [--json]
 *
 * JSON: { "alias": "" } for none, { "alias": "ad" }, or { "error": "..." } when
 * the saved value is not a bare command word. */
import { runAsScript } from '../lib/mod-scripts.mjs';

/* the body lives in lib/mod-scripts.mjs, which the local server runs in process */
await runAsScript('mod-alias');
