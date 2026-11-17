/* The board URL and token in force, read without the transport, so a light
   module (the PC name) need not load board-call.mjs. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './node-helpers.mjs';

/* a process that keeps the saved options (the local server) hands them here: for an env
   it vouches for, its copy (an object, null for no file) stands for the file, else undefined */
let savedOptions = null;
export function useSavedOptions(fn) { savedOptions = typeof fn === 'function' ? fn : null; }

function setting(env, envName, key) {
  const named = typeof env[envName] === 'string' ? env[envName].trim() : '';
  if (named) return named;
  const kept = savedOptions ? savedOptions(env) : undefined;
  if (kept !== undefined) {
    const v = kept && kept[key];
    return typeof v === 'string' ? v.trim() : '';
  }
  const dir = dataDir(env);
  if (!dir) return '';
  try {
    const v = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'))[key];
    return typeof v === 'string' ? v.trim() : '';
  } catch { return ''; }
}

/* The board URL in force, or '' when none is set. */
export const boardUrl = (env = process.env) => setting(env, 'ASKERDO_BOARD_URL', 'boardUrl');
/* This PC's device token for an http(s) board, or ''. */
export const boardToken = (env = process.env) => setting(env, 'ASKERDO_BOARD_TOKEN', 'boardToken');
