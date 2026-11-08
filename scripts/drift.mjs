#!/usr/bin/env node
/* The mod's door to the drift line on Home: what the project's pointers
 * cite that is gone, rule lines over the cap, new files in a retired workflow folder.
 *
 *   node scripts/drift.mjs --root <git root>   (the rule rows as JSON on stdin)
 *
 * Read-only; answers the drift result as JSON, or null when nothing is off. */
import { runAsScript } from '../lib/mod-scripts.mjs';

await runAsScript('drift');
