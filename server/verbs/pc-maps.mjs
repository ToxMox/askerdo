/* Each PC's project map (a project's shared name to that PC's folder), so a path
   written on one PC opens on another whose folders differ. Kept in meta, not a
   table of its own: the schema stays put, so an older board server opens the file. */
import { tx } from '../db.mjs';
import { actorOf, getMeta, setMeta } from '../records.mjs';

const PREFIX = 'pc.map.';
const MAX_ENTRIES = 500;
const ABS = /^(?:[A-Za-z]:)?[\\/]/;
const UNC = /^(?:\\\\|\/\/)/;

/* only well formed entries are kept: a stray one in a PC's file never fails its call */
function cleanMap(v) {
  const out = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [name, dir] of Object.entries(v).slice(0, MAX_ENTRIES)) {
    if (!name || name.length > 512 || typeof dir !== 'string' || dir.length > 1024) continue;
    if (!ABS.test(dir) || UNC.test(dir)) continue;
    out[name] = dir;
  }
  return out;
}

const parsed = (s) => { try { return JSON.parse(s); } catch { return null; } };

/* pcMap { map }: the calling PC's map kept when given and changed; every PC's map back. */
export function pcMap(db, input = {}, actor, opts) {
  const a = actorOf(actor, opts);
  const pc = a.pc || 'local';
  if (input && input.map !== undefined) {
    const map = cleanMap(input.map);
    const had = parsed(getMeta(db, PREFIX + pc));
    if (!had || JSON.stringify(had.map) !== JSON.stringify(map)) tx(db, () => setMeta(db, PREFIX + pc, { map, at: a.at }));
  }
  const maps = db.stmt("SELECT name, value FROM meta WHERE name LIKE 'pc.map.%' ORDER BY name").all()
    .map((r) => ({ pc: r.name.slice(PREFIX.length), ...(parsed(r.value) || {}) }))
    .map((r) => ({ pc: r.pc, map: cleanMap(r.map), at: r.at || null }));
  return { pc, maps };
}

/* Inside the caller's transaction: a PC's map gone, as its token's revoke takes it. */
export function dropPcMap(db, pc) {
  db.stmt('DELETE FROM meta WHERE name = ?').run(PREFIX + pc);
}
