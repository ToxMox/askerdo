#!/usr/bin/env node
/* The mod's door to the rules in force: the session's held track (on
 * the board), else its in_progress task, else its project,
 * rendered once for the mod to append to agent briefs and put in the session's prompt.
 *
 *   node scripts/rules.mjs --cwd <project dir> [--session <id>] [--track TR-n or key] [--json]
 *
 * Read-only. Exit 1 on bad input or an unusable seam; the mod then injects nothing. */
import { runAsScript } from '../lib/mod-scripts.mjs';

/* the body lives in lib/mod-scripts.mjs, which the local server runs in process */
await runAsScript('rules');
