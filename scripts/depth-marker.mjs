#!/usr/bin/env node
/* The mod's one door to the depth settings: resolves the
 * session's profiles through the board, keeps its marker current, and prints
 * what is in force. The mod has no fs of its own outside $.fs.
 *
 *   node scripts/depth-marker.mjs --cwd <project dir> [--session <id>] [--track <key>]
 *        [--write] [--project on|off] [--json]
 *
 * The marker is <claude home>/projects/<slug>/<track key>/depth-guard.json for a track-holding
 * session, else <claude home>/projects/<slug>/depth-guard.json; it exists
 * only where a profile sets something. --project on|off is /askerdo guard: the
 * guard-on or guard-off profile on the project. Exit 1 on bad input or an
 * unusable seam. --write is kept for older callers; the marker is always synced. */
import { runAsScript } from '../lib/mod-scripts.mjs';

/* the body lives in lib/mod-scripts.mjs, which the local server runs in process */
await runAsScript('depth-marker');
