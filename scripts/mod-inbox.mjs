#!/usr/bin/env node
/* A session's inbox for the mod's answer delivery, which
 * replaces the settings-hook drains in a mod session. Under the store lock,
 * as the drains take it.
 *
 *   node scripts/mod-inbox.mjs take --session <id> [--lineage <id,id>] [--ack] [--id Q-n] --json
 *   node scripts/mod-inbox.mjs put --session <id> --json   (stdin: the events take printed)
 *   node scripts/mod-inbox.mjs peek --session <id> [--lineage <id,id>] --json  (what take would print, nothing moved)
 *
 * take prints { events: [{ key, line, raw, box }] } and keeps them in the inbox's
 * processing file until a later take acks their keys (--ack, stdin { <session>: [key] }),
 * so a reply that never arrives loses nothing; --lineage reads the ids before a
 * /clear in the same call. With --id only that record's events leave the fresh inbox.
 * put appends events back. peek is the band's count. Outside hub mode, or
 * with no store, nothing is printed or touched. */
import { runAsScript } from '../lib/mod-scripts.mjs';

/* the body lives in lib/mod-scripts.mjs, which the local server runs in process */
await runAsScript('mod-inbox');
