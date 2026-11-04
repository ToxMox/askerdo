#!/usr/bin/env node
/* Prints the mod's contract section and the reply checks' switches from the
 * saved options, for the mod, which cannot resolve the data directory itself.
 *
 *   node scripts/mod-contract.mjs --json
 *
 * JSON: { "section": "...", "checks": { "emdash", "forecast", "hub", "agents" },
 * "surfaces": { "desktop", "terminal" } }, or { "section": null, "checks": null }
 * with no saved options (no contract). */
import { runAsScript } from '../lib/mod-scripts.mjs';

/* the body lives in lib/mod-scripts.mjs, which the local server runs in process */
await runAsScript('mod-contract');
