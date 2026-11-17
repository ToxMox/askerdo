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

/* the commit of the server tree this board was built from. install.sh writes
   build.json beside this file from its tag (the image holds no .git); none reads null. */
export function boardCommit(file = new URL('./build.json', import.meta.url)) {
  try {
    const c = JSON.parse(readFileSync(file, 'utf8')).commit;
    return typeof c === 'string' && /^[0-9a-f]{7,40}$/.test(c) ? c : null;
  } catch {
    return null;
  }
}
