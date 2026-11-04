#!/usr/bin/env node
/* The user's queued answers, kept in this PC's AskerDo data folder until Send,
 * for the mod, which cannot reach the data folder itself.
 *
 *   node scripts/mod-queue.mjs read --session <id> [--lineage <id,id>] --json
 *   node scripts/mod-queue.mjs write --session <id> [--lineage <id,id>] --json   (stdin: the list)
 *
 * read prints { answers: [...] }; write replaces the session's list and drops the
 * lineage's, so a /clear carries them to the new id. */
import { runAsScript } from '../lib/mod-scripts.mjs';

/* the body lives in lib/mod-scripts.mjs, which the local server runs in process */
await runAsScript('mod-queue');
