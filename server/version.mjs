/* The plugin version this board's code came from. scripts/build.mjs writes version.json
   beside this file from the plugin manifest, so the image, the kit and a board run from
   the plugin folder all carry it in server/; a copy without it says unknown. */
import { readFileSync } from 'node:fs';

export const UNKNOWN_VERSION = 'unknown';

export function boardVersion(file = new URL('./version.json', import.meta.url)) {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8')).version;
    return typeof v === 'string' && /^\d+(\.\d+)*$/.test(v) ? v : UNKNOWN_VERSION;
  } catch {
    return UNKNOWN_VERSION;
  }
}
