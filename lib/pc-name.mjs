/* This PC's name, light enough for the inbox spawn to load alone. */
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { boardUrl } from './board-setting.mjs';
import { storeRoot } from './node-helpers.mjs';

/* this PC as the board names it, the device its token carries, which the
   local board learns from its own sessions' rows; the hostname until one is known */
export function pcName(env = process.env) {
  try {
    const p = JSON.parse(readFileSync(join(storeRoot(undefined, env), 'board', 'sessions.json'), 'utf8'));
    const url = boardUrl(env).replace(/\/+$/, '');
    if (p && typeof p.pc === 'string' && p.pc && url && String(p.board).replace(/\/+$/, '') === url) return p.pc;
  } catch {}
  return hostname();
}
