#!/usr/bin/env node
/* Marks, in this PC's AskerDo data folder, a session whose main prompt has no carrier
 * section for the mod's blocks, or whose prompt hooks do not run, for askerdo status; the mod
 * cannot reach the folder itself.
 *
 *   node scripts/mod-carrier.mjs missing --session <id>
 *   node scripts/mod-carrier.mjs off --session <id>
 *   node scripts/mod-carrier.mjs seen --session <id>
 *
 * missing and off write their mark (keeping the first sighting), each replacing the other's; seen
 * clears it. Prints { marked, changed }. */
import { runAsScript } from '../lib/mod-scripts.mjs';

/* the body lives in lib/mod-scripts.mjs, which the local server runs in process */
await runAsScript('mod-carrier');
